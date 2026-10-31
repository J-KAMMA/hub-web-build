/**
 * Solana token-gate reader (design section 3). Server-side reads only, at `finalized` commitment.
 *
 * Counts only:
 *  - SOL: `getBalance` of each verified linked wallet.
 *  - SPL / Token-2022: accounts returned by `getTokenAccountsByOwner(wallet, {mint}, jsonParsed)` that are owned by the
 *    SPL Token or Token-2022 program, whose mint and owner equal the requested ones, and whose state is `initialized`
 *    (frozen accounts do not count). Amounts are decimal strings summed as BigInt across accounts and wallets.
 *  - spl_mints: the same, for each listed mint, with decimals 0 and amount >= 1 (an NFT-style holding).
 *
 * Anything uncertain -- HTTP error, timeout, JSON-RPC error, wrong shape -- is a failure, never a partial grant.
 * No address, balance or mint amount is logged or cached by this module.
 */

export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SPL_TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SOLANA_GATE_COMMITMENT = "finalized";
export const SOLANA_GATE_RPC_TIMEOUT_MS = 8_000;
export const SOLANA_GATE_MAX_REQUESTS = 500;

export type SolanaGateFailureReason = "rpc_error" | "malformed_response" | "too_many_calls";

export class SolanaGateReadFailure extends Error {
  constructor(readonly reason: SolanaGateFailureReason) {
    super(reason);
  }
}

export type SolanaGateTri = "yes" | "no" | "unknown";

export type SolanaGateCondition = {
  /** Index in the gate's condition list; used as the result key. */
  index: number;
  kind: "sol_native" | "spl" | "spl_mints";
  /** spl: one mint; spl_mints: the mint list; sol_native: empty. */
  mints: readonly string[];
  min: bigint;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AMOUNT = /^[0-9]{1,20}$/;

async function rpc(fetchFn: FetchLike, url: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOLANA_GATE_RPC_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new SolanaGateReadFailure("rpc_error");
    body = await response.json();
  } catch (error) {
    if (error instanceof SolanaGateReadFailure) throw error;
    throw new SolanaGateReadFailure("rpc_error");
  } finally {
    clearTimeout(timer);
  }
  if (!body || typeof body !== "object") throw new SolanaGateReadFailure("malformed_response");
  const envelope = body as { result?: unknown; error?: unknown };
  if (envelope.error) throw new SolanaGateReadFailure("rpc_error");
  if (envelope.result === undefined || envelope.result === null) throw new SolanaGateReadFailure("malformed_response");
  return envelope.result;
}

export async function readLamports(fetchFn: FetchLike, url: string, wallet: string): Promise<bigint> {
  const result = await rpc(fetchFn, url, "getBalance", [wallet, { commitment: SOLANA_GATE_COMMITMENT }]) as { value?: unknown };
  const value = result?.value;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new SolanaGateReadFailure("malformed_response");
  return BigInt(value);
}

type TokenAccountEntry = {
  account?: {
    owner?: unknown;
    data?: { parsed?: { info?: { mint?: unknown; owner?: unknown; state?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } };
  };
};

/** Sum of the wallet's eligible token accounts for one mint, and whether the mint has decimals 0 on every counted account. */
export async function readTokenAmount(
  fetchFn: FetchLike,
  url: string,
  wallet: string,
  mint: string,
): Promise<{ amount: bigint; allZeroDecimals: boolean }> {
  const result = await rpc(fetchFn, url, "getTokenAccountsByOwner", [
    wallet,
    { mint },
    { commitment: SOLANA_GATE_COMMITMENT, encoding: "jsonParsed" },
  ]) as { value?: unknown };
  if (!result || !Array.isArray(result.value)) throw new SolanaGateReadFailure("malformed_response");
  let amount = BigInt(0);
  let allZeroDecimals = true;
  for (const entry of result.value as TokenAccountEntry[]) {
    const owner = entry?.account?.owner;
    const info = entry?.account?.data?.parsed?.info;
    if (owner !== SPL_TOKEN_PROGRAM && owner !== SPL_TOKEN_2022_PROGRAM) continue;
    if (!info || info.mint !== mint || info.owner !== wallet || info.state !== "initialized") continue;
    const raw = info.tokenAmount?.amount;
    if (typeof raw !== "string" || !AMOUNT.test(raw)) throw new SolanaGateReadFailure("malformed_response");
    const counted = BigInt(raw);
    if (counted > BigInt(0) && info.tokenAmount?.decimals !== 0) allZeroDecimals = false;
    amount += counted;
  }
  return { amount, allZeroDecimals };
}

/**
 * Evaluates Solana conditions over the viewer's verified Solana wallets. Returns one tri-state per condition.
 * A condition whose read partly failed is "unknown" unless the amounts already read are enough to grant.
 */
export async function evaluateSolanaConditions(input: {
  fetch: FetchLike;
  rpcUrl: string;
  conditions: readonly SolanaGateCondition[];
  wallets: readonly string[];
}): Promise<Map<number, SolanaGateTri>> {
  const { conditions, wallets } = input;
  let requests = 0;
  for (const condition of conditions) {
    requests += wallets.length * (condition.kind === "spl_mints" ? condition.mints.length : 1);
  }
  if (requests > SOLANA_GATE_MAX_REQUESTS) throw new SolanaGateReadFailure("too_many_calls");

  const out = new Map<number, SolanaGateTri>();
  await Promise.all(conditions.map(async (condition) => {
    let total = BigInt(0);
    let failed = false;
    let nftHeld = false;
    await Promise.all(wallets.flatMap((wallet) => {
      if (condition.kind === "sol_native") {
        return [readLamports(input.fetch, input.rpcUrl, wallet).then((v) => { total += v; }, () => { failed = true; })];
      }
      return condition.mints.map((mint) =>
        readTokenAmount(input.fetch, input.rpcUrl, wallet, mint).then(
          (read) => {
            if (condition.kind === "spl_mints") {
              if (read.amount >= BigInt(1) && read.allZeroDecimals) nftHeld = true;
            } else {
              total += read.amount;
            }
          },
          () => { failed = true; },
        ));
    }));
    const satisfied = condition.kind === "spl_mints" ? nftHeld : total >= condition.min;
    out.set(condition.index, satisfied ? "yes" : failed ? "unknown" : "no");
  }));
  return out;
}
