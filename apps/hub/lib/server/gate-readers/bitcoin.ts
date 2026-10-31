/**
 * Bitcoin native gate reader (design section 3). Server-side reads only, against the configured indexer
 * (Esplora-compatible `HUB_RPC_URL_BITCOIN_<NETWORK>`; defaults are never used for gates).
 *
 * Counts only CONFIRMED UTXOs with at least the registry's confirmations (3 on mainnet, 1 on testnets). Mempool
 * funds and unconfirmed outputs never count. If the indexer cannot return the full UTXO set (error for a large
 * address, or more than 500 UTXOs) the result is `unavailable`, never a partial sum. Everything uncertain fails
 * closed. Nothing here logs or returns an address, a UTXO or an amount beyond the sum used for the comparison.
 */
import { parseBitcoinAddress } from "@/lib/chains/address/bitcoin";
import { getBitcoinNetwork, resolveBitcoinIndexer } from "@/lib/chains/bitcoin-chain-registry";

export const BITCOIN_GATE_MAX_UTXOS = 500;
export const BITCOIN_GATE_TIMEOUT_MS = 8_000;

export type BitcoinGateReason = "unsupported_chain" | "rpc_not_configured" | "rpc_error" | "malformed_response" | "too_many_utxos" | "invalid_gate" | "no_wallet";

export type BitcoinBalanceRead =
  | { state: "ok"; satoshis: bigint }
  | { state: "unavailable"; reason: BitcoinGateReason };

type Deps = {
  fetch: typeof fetch;
  env: Readonly<Record<string, string | undefined>>;
};

class Unavailable extends Error {
  constructor(readonly reason: BitcoinGateReason) {
    super(reason);
  }
}

async function getText(deps: Deps, url: string): Promise<string> {
  let response: Response;
  try {
    response = await deps.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(BITCOIN_GATE_TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new Unavailable("rpc_error");
  }
  // 400 from public Esplora backends means "too many UTXOs" or a refused address: not a partial answer.
  if (!response.ok) throw new Unavailable(response.status === 400 ? "too_many_utxos" : "rpc_error");
  try {
    return await response.text();
  } catch {
    throw new Unavailable("rpc_error");
  }
}

const isNonNegativeInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

async function confirmedBalanceOf(deps: Deps, base: string, address: string, tip: number, minConfirmations: number): Promise<bigint> {
  const text = await getText(deps, `${base}/address/${encodeURIComponent(address)}/utxo`);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Unavailable("malformed_response"); }
  if (!Array.isArray(data)) throw new Unavailable("malformed_response");
  if (data.length > BITCOIN_GATE_MAX_UTXOS) throw new Unavailable("too_many_utxos");
  let sum = 0n;
  for (const item of data as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") throw new Unavailable("malformed_response");
    const status = item.status as Record<string, unknown> | undefined;
    if (typeof item.txid !== "string" || !/^[0-9a-f]{64}$/.test(item.txid) || !isNonNegativeInt(item.vout) || !isNonNegativeInt(item.value) || item.value === 0 || !status || typeof status.confirmed !== "boolean") {
      throw new Unavailable("malformed_response");
    }
    if (!status.confirmed) continue; // mempool: never counts
    const height = status.block_height;
    if (!isNonNegativeInt(height) || height > tip) throw new Unavailable("malformed_response");
    if (tip - height + 1 >= minConfirmations) sum += BigInt(item.value);
  }
  return sum;
}

/** Sum of confirmed, sufficiently deep UTXOs over the given addresses on one network. */
export async function readConfirmedBitcoinBalance(
  input: { chainRef: string; addresses: readonly string[] },
  deps: Deps = { fetch: (url, init) => fetch(url, init), env: process.env },
): Promise<BitcoinBalanceRead> {
  try {
    const network = getBitcoinNetwork(input.chainRef);
    if (!network) throw new Unavailable("unsupported_chain");
    const base = resolveBitcoinIndexer(network, deps.env);
    if (!base) throw new Unavailable("rpc_not_configured");
    const addresses = new Set<string>();
    for (const raw of input.addresses) {
      try { addresses.add(parseBitcoinAddress(input.chainRef, raw).normalized); } catch { throw new Unavailable("malformed_response"); }
    }
    const tipText = (await getText(deps, `${base}/blocks/tip/height`)).trim();
    if (!/^[0-9]{1,9}$/.test(tipText)) throw new Unavailable("malformed_response");
    const tip = Number(tipText);
    let total = 0n;
    for (const address of addresses) total += await confirmedBalanceOf(deps, base, address, tip, network.minConfirmations);
    return { state: "ok", satoshis: total };
  } catch (error) {
    return { state: "unavailable", reason: error instanceof Unavailable ? error.reason : "rpc_error" };
  }
}

export type BitcoinNativeCondition = { chainRef: string; minRaw: bigint };

/** Parse a stored `btc_native` condition (chain_ref + min_raw in satoshis). Null = invalid gate. */
export function parseBitcoinNativeCondition(condition: { chainRef?: string | null; minRaw: string | null }): BitcoinNativeCondition | null {
  if (typeof condition.chainRef !== "string" || !getBitcoinNetwork(condition.chainRef)) return null;
  if (typeof condition.minRaw !== "string" || !/^[1-9][0-9]{0,18}$/.test(condition.minRaw)) return null;
  return { chainRef: condition.chainRef, minRaw: BigInt(condition.minRaw) };
}

export type BitcoinConditionOutcome =
  | { state: "yes" | "no" }
  | { state: "unknown"; reason: BitcoinGateReason };

/** `addresses` = the viewer's signature-verified linked Bitcoin addresses on this condition's network. */
export async function evaluateBitcoinNative(
  condition: BitcoinNativeCondition,
  addresses: readonly string[],
  deps?: Deps,
): Promise<BitcoinConditionOutcome> {
  if (addresses.length === 0) return { state: "no" };
  const read = await readConfirmedBitcoinBalance({ chainRef: condition.chainRef, addresses }, deps);
  if (read.state !== "ok") return { state: "unknown", reason: read.reason };
  return { state: read.satoshis >= condition.minRaw ? "yes" : "no" };
}
