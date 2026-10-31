/**
 * Bitcoin wallet reads for the Hub wallet view and send flow (design sections 4-5), on the network registry.
 *
 * Reads use the wallet indexer (`resolveBitcoinWalletIndexer`): the configured `HUB_RPC_URL_BITCOIN_<NETWORK>`,
 * or a public default outside production on the testnets. These reads only DISPLAY; nothing here grants access
 * or confirms a tip (gates and tips use the configured indexer only: gate-readers/bitcoin.ts, wallet-tips-bitcoin.ts).
 * Balances keep confirmed and pending (mempool) amounts apart. Hub never holds keys; it relays a transaction
 * that the user's wallet already signed, after re-checking it against the values the user confirmed.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { parseBitcoinAddress, BitcoinAddressError } from "@/lib/chains/address/bitcoin";
import { bitcoinNetworkAvailable, getBitcoinNetwork, resolveBitcoinWalletIndexer, type BitcoinNetworkEntry } from "@/lib/chains/bitcoin-chain-registry";
import { BitcoinSendError, verifySignedBitcoinSend, type ExpectedSend, type SpendableUtxo } from "@/lib/wallet/bitcoin-psbt";

export class BitcoinWalletInputError extends Error {}
export class BitcoinWalletNetworkError extends Error {}
export class BitcoinWalletVerificationError extends Error {}

type Deps = { fetch: typeof fetch; env: Readonly<Record<string, string | undefined>> };
const defaultDeps = (): Deps => ({ fetch: (url, init) => fetch(url, init), env: process.env });

export function normalizeBitcoinTxid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new BitcoinWalletInputError("Bitcoin TXIDが正しくありません。");
  return value.toLowerCase();
}

function networkAndBase(chainRef: unknown, deps: Deps): { network: BitcoinNetworkEntry; base: string } {
  const network = getBitcoinNetwork(chainRef);
  if (!network || !bitcoinNetworkAvailable(network, deps.env)) throw new BitcoinWalletInputError("このBitcoinネットワークは利用できません。");
  const base = resolveBitcoinWalletIndexer(network, deps.env);
  if (!base) throw new BitcoinWalletNetworkError("Bitcoin APIが設定されていません。");
  return { network, base };
}

function checkedAddress(chainRef: string, address: unknown) {
  try {
    return parseBitcoinAddress(chainRef, address);
  } catch (error) {
    throw new BitcoinWalletInputError(error instanceof BitcoinAddressError && error.code === "wrong_network" ? "別のBitcoinネットワークのアドレスです。" : "Bitcoinアドレスが正しくありません。");
  }
}

async function request(deps: Deps, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  } catch {
    throw new BitcoinWalletNetworkError("Bitcoinネットワークへ接続できません。");
  }
  return response;
}

async function readJson<T>(deps: Deps, url: string): Promise<T> {
  const response = await request(deps, url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new BitcoinWalletNetworkError("Bitcoin APIが応答しませんでした。");
  try { return await response.json() as T; } catch { throw new BitcoinWalletNetworkError("Bitcoin APIの応答が正しくありません。"); }
}

const safeInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Confirmed and pending balance, kept apart. */
export async function readBitcoinOverview(input: { chainRef: unknown; address: unknown }, deps: Deps = defaultDeps()) {
  const { network, base } = networkAndBase(input.chainRef, deps);
  const address = checkedAddress(network.chainRef, input.address);
  const data = await readJson<{ chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }; mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } }>(deps, `${base}/address/${encodeURIComponent(address.normalized)}`);
  const c = data.chain_stats, m = data.mempool_stats;
  if (!c || !m || ![c.funded_txo_sum, c.spent_txo_sum, m.funded_txo_sum, m.spent_txo_sum].every(safeInt)) throw new BitcoinWalletNetworkError("Bitcoin APIの応答が正しくありません。");
  return {
    chainRef: network.chainRef,
    network: network.name,
    testnet: network.testnet,
    address: address.normalized,
    kind: address.kind,
    confirmedSats: (c.funded_txo_sum as number) - (c.spent_txo_sum as number),
    pendingSats: (m.funded_txo_sum as number) - (m.spent_txo_sum as number),
  };
}

export const MAX_SEND_UTXOS = 500;

/** Confirmed and pending UTXOs of an address (for building a send). More than 500 is refused rather than truncated. */
export async function readBitcoinUtxos(input: { chainRef: unknown; address: unknown }, deps: Deps = defaultDeps()): Promise<{ chainRef: string; address: string; utxos: SpendableUtxo[] }> {
  const { network, base } = networkAndBase(input.chainRef, deps);
  const address = checkedAddress(network.chainRef, input.address);
  const list = await readJson<unknown>(deps, `${base}/address/${encodeURIComponent(address.normalized)}/utxo`);
  if (!Array.isArray(list) || list.length > MAX_SEND_UTXOS) throw new BitcoinWalletNetworkError("UTXOが多すぎるか、応答が正しくありません。");
  const utxos: SpendableUtxo[] = [];
  for (const item of list as Array<Record<string, unknown>>) {
    const status = item?.status as Record<string, unknown> | undefined;
    if (!item || typeof item.txid !== "string" || !/^[0-9a-f]{64}$/.test(item.txid) || !safeInt(item.vout) || !safeInt(item.value) || !status || typeof status.confirmed !== "boolean") {
      throw new BitcoinWalletNetworkError("Bitcoin APIの応答が正しくありません。");
    }
    utxos.push({ txid: item.txid, vout: item.vout, value: item.value, confirmed: status.confirmed, ...(safeInt(status.block_height) ? { height: status.block_height } : {}) });
  }
  return { chainRef: network.chainRef, address: address.normalized, utxos };
}

export type BitcoinFeeRates = { fast: number; normal: number; slow: number; source: "mempool" | "esplora" };

export async function readBitcoinFeeRates(input: { chainRef: unknown }, deps: Deps = defaultDeps()): Promise<BitcoinFeeRates> {
  const { base } = networkAndBase(input.chainRef, deps);
  const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 1000 ? Math.ceil(n) : null);
  const mempool = await request(deps, `${base}/v1/fees/recommended`, { headers: { accept: "application/json" } });
  if (mempool.ok) {
    const f = await mempool.json().catch(() => null) as { fastestFee?: number; halfHourFee?: number; hourFee?: number } | null;
    const fast = clamp(f?.fastestFee), normal = clamp(f?.halfHourFee), slow = clamp(f?.hourFee);
    if (fast && normal && slow) return { fast, normal, slow, source: "mempool" };
  }
  const esplora = await readJson<Record<string, number>>(deps, `${base}/fee-estimates`);
  const fast = clamp(esplora["1"]), normal = clamp(esplora["3"]), slow = clamp(esplora["6"]);
  if (!fast || !normal || !slow) throw new BitcoinWalletNetworkError("手数料の見積もりを取得できません。");
  return { fast, normal, slow, source: "esplora" };
}

export type BitcoinHistoryItem = { txid: string; confirmed: boolean; blockHeight: number | null; netSats: number };

/** Last 20 transactions of an address with the net amount for that address. */
export async function readBitcoinHistory(input: { chainRef: unknown; address: unknown }, deps: Deps = defaultDeps()): Promise<{ items: BitcoinHistoryItem[] }> {
  const { network, base } = networkAndBase(input.chainRef, deps);
  const address = checkedAddress(network.chainRef, input.address);
  const txs = await readJson<unknown>(deps, `${base}/address/${encodeURIComponent(address.normalized)}/txs`);
  if (!Array.isArray(txs)) throw new BitcoinWalletNetworkError("Bitcoin APIの応答が正しくありません。");
  const items: BitcoinHistoryItem[] = [];
  for (const tx of (txs as Array<Record<string, unknown>>).slice(0, 20)) {
    const status = tx.status as { confirmed?: boolean; block_height?: number } | undefined;
    if (typeof tx.txid !== "string" || !/^[0-9a-f]{64}$/.test(tx.txid) || !status || typeof status.confirmed !== "boolean" || !Array.isArray(tx.vin) || !Array.isArray(tx.vout)) continue;
    let net = 0;
    for (const out of tx.vout as Array<{ scriptpubkey?: string; value?: number }>) if (out.scriptpubkey === address.scriptPubKeyHex && safeInt(out.value)) net += out.value;
    for (const input_ of tx.vin as Array<{ prevout?: { scriptpubkey?: string; value?: number } | null }>) if (input_.prevout?.scriptpubkey === address.scriptPubKeyHex && safeInt(input_.prevout.value)) net -= input_.prevout.value;
    items.push({ txid: tx.txid, confirmed: status.confirmed, blockHeight: safeInt(status.block_height) ? status.block_height : null, netSats: net });
  }
  return { items };
}

/**
 * Relay a signed transaction. The profile must have a signature-verified link to the sending address (this is not
 * an open relay), the transaction must match the values the user confirmed, and every input must be a confirmed
 * UTXO of that address. Hub never signs, and cannot reverse the transfer.
 */
export async function broadcastBitcoinSend(input: {
  database: D1Database;
  profileId: string;
  chainRef: unknown;
  from: unknown;
  signed: { psbtBase64?: string; rawHex?: string };
  expected: ExpectedSend;
}, deps: Deps = defaultDeps()): Promise<{ txid: string }> {
  const { network, base } = networkAndBase(input.chainRef, deps);
  if (input.expected?.chainRef !== network.chainRef) throw new BitcoinWalletVerificationError("ネットワークが一致しません。");
  const from = checkedAddress(network.chainRef, input.from);
  if (from.kind === "p2tr") throw new BitcoinWalletVerificationError("タプルートアドレスからの送金は現在できません。");
  const linked = await input.database.prepare(`SELECT 1 AS ok FROM profile_wallet_accounts a
      JOIN wallet_account_networks n ON n.wallet_account_id = a.id AND n.network_reference = ? AND n.enabled = 1
      WHERE a.profile_id = ? AND a.namespace = 'bip122' AND a.normalized_address = ? AND a.verification_status = 'verified' LIMIT 1`)
    .bind(network.chainRef, input.profileId, from.normalized).first<{ ok: number }>();
  if (!linked) throw new BitcoinWalletVerificationError("送信元アドレスが連携されていません。");

  const known = await readBitcoinUtxos({ chainRef: network.chainRef, address: from.normalized }, deps);
  const spendable = new Map(known.utxos.filter((u) => u.confirmed).map((u) => [`${u.txid}:${u.vout}`, u.value]));
  for (const item of input.expected.inputs ?? []) {
    if (spendable.get(`${item.txid}:${item.vout}`) !== Number(item.value)) throw new BitcoinWalletVerificationError("入力が現在のUTXOと一致しません。");
  }
  let verified;
  try {
    verified = verifySignedBitcoinSend(input.signed, input.expected);
  } catch (error) {
    if (error instanceof BitcoinSendError) throw new BitcoinWalletVerificationError("署名済み取引が確認した内容と一致しません。");
    throw error;
  }
  const response = await request(deps, `${base}/tx`, { method: "POST", body: verified.hex, headers: { "content-type": "text/plain" } });
  if (!response.ok) throw new BitcoinWalletNetworkError("取引をネットワークへ送信できませんでした。");
  return { txid: verified.txid };
}
