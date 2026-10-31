/**
 * Bitcoin tips (design section 5). Non-custodial: the sender pays directly from a wallet linked to their Hub
 * profile to an address the recipient explicitly enabled for tips. Hub never holds funds.
 *
 * A tip is confirmed only when a server-side read of the configured indexer proves, for the claimed txid:
 *  - the transaction is confirmed with at least the registry's confirmations (unconfirmed = "pending", nothing stored);
 *  - EVERY input spends an output whose scriptPubKey belongs to an address the sender verified (so a coinjoin or
 *    someone else's funds cannot be claimed);
 *  - the outputs paying the recipient's tip-enabled scriptPubKeys sum to a positive amount of at least the
 *    recipient's minimum.
 * The ledger row has no sender address. Reuse of a txid, self-tips, wrong networks and indexer failures are
 * rejected; an indexer failure stores nothing. Callers never supply a sender or an amount: both are derived here.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { getBitcoinNetwork, resolveBitcoinIndexer, type BitcoinNetworkEntry } from "@/lib/chains/bitcoin-chain-registry";
import { tryParseBitcoinAddress } from "@/lib/chains/address/bitcoin";

export class BitcoinTipInputError extends Error {}
export class BitcoinTipPermissionError extends Error {}
export class BitcoinTipVerificationError extends Error {}
export class BitcoinTipUnavailableError extends Error {}

type Deps = { fetch: typeof fetch; env: Readonly<Record<string, string | undefined>>; now?: () => Date };

type EsploraTx = {
  txid: string;
  status: { confirmed: boolean; block_height?: number };
  vin: Array<{ is_coinbase?: boolean; prevout?: { scriptpubkey?: string; value?: number } | null }>;
  vout: Array<{ scriptpubkey?: string; value?: number }>;
};

const HEX64 = /^[0-9a-f]{64}$/;
const SCRIPT_HEX = /^(?:[0-9a-f]{2}){1,100}$/;

export function normalizeBitcoinTxid(value: unknown): string {
  if (typeof value !== "string" || !HEX64.test(value.toLowerCase())) throw new BitcoinTipInputError("invalid_txid");
  return value.toLowerCase();
}

async function fetchText(deps: Deps, url: string): Promise<string> {
  let response: Response;
  try {
    response = await deps.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  } catch {
    throw new BitcoinTipUnavailableError("indexer_unreachable");
  }
  if (response.status === 404) throw new BitcoinTipVerificationError("transaction_not_found");
  if (!response.ok) throw new BitcoinTipUnavailableError("indexer_error");
  return response.text();
}

function parseTx(text: string, txid: string): EsploraTx {
  let data: EsploraTx;
  try { data = JSON.parse(text) as EsploraTx; } catch { throw new BitcoinTipUnavailableError("indexer_malformed"); }
  if (!data || typeof data !== "object" || data.txid !== txid || !data.status || typeof data.status.confirmed !== "boolean" || !Array.isArray(data.vin) || !Array.isArray(data.vout)) {
    throw new BitcoinTipUnavailableError("indexer_malformed");
  }
  return data;
}

export type BitcoinTipCheck =
  | { state: "pending" }
  | { state: "confirmed"; amountSats: bigint };

/**
 * Pure check of an indexer transaction. `senderScripts` are the scriptPubKeys (hex) of the sender's verified
 * addresses on this network; `recipientScripts` those of the recipient's tip-enabled addresses.
 */
export function checkBitcoinTip(input: {
  tx: EsploraTx;
  tipHeight: number;
  minConfirmations: number;
  senderScripts: ReadonlySet<string>;
  recipientScripts: ReadonlySet<string>;
  minimumSats: bigint;
}): BitcoinTipCheck {
  const { tx } = input;
  if (input.senderScripts.size === 0) throw new BitcoinTipVerificationError("sender_has_no_verified_address");
  if (tx.vin.length === 0) throw new BitcoinTipVerificationError("sender_not_provable");
  for (const item of tx.vin) {
    const script = item.prevout?.scriptpubkey;
    if (item.is_coinbase || typeof script !== "string" || !SCRIPT_HEX.test(script)) throw new BitcoinTipVerificationError("sender_not_provable");
    // Every input must be the sender's: not just one of them.
    if (!input.senderScripts.has(script)) throw new BitcoinTipVerificationError("foreign_input");
  }
  let paid = 0n;
  for (const out of tx.vout) {
    if (typeof out.scriptpubkey === "string" && input.recipientScripts.has(out.scriptpubkey)) {
      if (!Number.isSafeInteger(out.value) || (out.value as number) < 0) throw new BitcoinTipUnavailableError("indexer_malformed");
      paid += BigInt(out.value as number);
    }
  }
  if (paid <= 0n) throw new BitcoinTipVerificationError("recipient_not_paid");
  if (paid < input.minimumSats) throw new BitcoinTipVerificationError("below_minimum");
  const height = tx.status.block_height;
  if (!tx.status.confirmed || !Number.isSafeInteger(height) || !Number.isSafeInteger(input.tipHeight)) return { state: "pending" };
  return input.tipHeight - (height as number) + 1 >= input.minConfirmations ? { state: "confirmed", amountSats: paid } : { state: "pending" };
}

async function verifiedScripts(database: D1Database, profileId: string, chainRef: string, extra = ""): Promise<Array<{ id: string; script: string; minimum: bigint }>> {
  const rows = await database.prepare(`SELECT a.id, a.normalized_address, a.minimum_tip_raw
      FROM profile_wallet_accounts a
      JOIN wallet_account_networks n ON n.wallet_account_id = a.id AND n.network_reference = ? AND n.enabled = 1
      WHERE a.profile_id = ? AND a.namespace = 'bip122' AND a.verification_status = 'verified' ${extra} LIMIT 50`)
    .bind(chainRef, profileId).all<{ id: string; normalized_address: string; minimum_tip_raw: string }>();
  const out: Array<{ id: string; script: string; minimum: bigint }> = [];
  for (const row of rows.results) {
    const parsed = tryParseBitcoinAddress(chainRef, row.normalized_address);
    if (parsed) out.push({ id: row.id, script: parsed.scriptPubKeyHex, minimum: /^[0-9]{1,30}$/.test(row.minimum_tip_raw) ? BigInt(row.minimum_tip_raw) : 0n });
  }
  return out;
}

export type ConfirmBitcoinTipInput = {
  database: D1Database;
  senderProfileId: string;
  chainRef: unknown;
  txid: unknown;
  recipientHandle: unknown;
  deps?: Deps;
};

export type ConfirmBitcoinTipResult = { status: "pending"; txid: string } | { status: "confirmed"; txid: string; amountSats: string };

export async function confirmBitcoinTip(input: ConfirmBitcoinTipInput): Promise<ConfirmBitcoinTipResult> {
  const deps: Deps = input.deps ?? { fetch: (url, init) => fetch(url, init), env: process.env };
  const network: BitcoinNetworkEntry | null = getBitcoinNetwork(input.chainRef);
  if (!network) throw new BitcoinTipInputError("unsupported_chain");
  const base = resolveBitcoinIndexer(network, deps.env);
  if (!base) throw new BitcoinTipUnavailableError("indexer_not_configured");
  const txid = normalizeBitcoinTxid(input.txid);
  const handle = typeof input.recipientHandle === "string" ? input.recipientHandle.trim().replace(/^@/, "") : "";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(handle)) throw new BitcoinTipInputError("invalid_recipient");

  const recipient = await input.database.prepare("SELECT id FROM profiles WHERE handle = ? LIMIT 1").bind(handle).first<{ id: string }>();
  if (!recipient) throw new BitcoinTipPermissionError("recipient_not_enabled");
  if (recipient.id === input.senderProfileId) throw new BitcoinTipPermissionError("self_tip");
  const targets = await verifiedScripts(input.database, recipient.id, network.chainRef, "AND a.tips_enabled = 1 AND a.visibility = 'public'");
  if (targets.length === 0) throw new BitcoinTipPermissionError("recipient_not_enabled");
  const senders = await verifiedScripts(input.database, input.senderProfileId, network.chainRef);
  if (senders.length === 0) throw new BitcoinTipVerificationError("sender_has_no_verified_address");

  const duplicate = await input.database.prepare("SELECT id FROM wallet_tip_transfers WHERE chain_ref = ? AND tx_ref = ?").bind(network.chainRef, txid).first<{ id: string }>();
  if (duplicate) throw new BitcoinTipVerificationError("already_recorded");

  const tx = parseTx(await fetchText(deps, `${base}/tx/${txid}`), txid);
  const tipText = (await fetchText(deps, `${base}/blocks/tip/height`)).trim();
  if (!/^[0-9]{1,9}$/.test(tipText)) throw new BitcoinTipUnavailableError("indexer_malformed");

  const minimum = targets.reduce((lowest, item) => (item.minimum < lowest ? item.minimum : lowest), targets[0]!.minimum);
  const checked = checkBitcoinTip({
    tx,
    tipHeight: Number(tipText),
    minConfirmations: network.minConfirmations,
    senderScripts: new Set(senders.map((item) => item.script)),
    recipientScripts: new Set(targets.map((item) => item.script)),
    minimumSats: minimum,
  });
  if (checked.state === "pending") return { status: "pending", txid };

  const now = (deps.now?.() ?? new Date()).toISOString();
  const assetRef = `${network.chainRef}/slip44:0`;
  try {
    await input.database.prepare(`INSERT INTO wallet_tip_transfers
        (id, chain_ref, tx_ref, asset_ref, amount_raw, sender_profile_id, recipient_profile_id, recipient_wallet_account_id, confirmed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`tip-${crypto.randomUUID()}`, network.chainRef, txid, assetRef, checked.amountSats.toString(), input.senderProfileId, recipient.id, targets[0]!.id, now, now).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new BitcoinTipVerificationError("already_recorded");
    throw error;
  }
  return { status: "confirmed", txid, amountSats: checked.amountSats.toString() };
}

/** Own settings for a verified Bitcoin account: enable tips, set the minimum (satoshis) and visibility. Verified rows only. */
export async function updateBitcoinTipSettings(input: {
  database: D1Database;
  profileId: string;
  accountId: unknown;
  enabled: unknown;
  minimumSats: unknown;
  visibility?: unknown;
}): Promise<{ accountId: string; tipsEnabled: boolean; minimumSats: string; visibility: "private" | "public" }> {
  if (typeof input.accountId !== "string" || !/^[0-9a-z-]{10,80}$/i.test(input.accountId)) throw new BitcoinTipInputError("invalid_account");
  if (typeof input.enabled !== "boolean") throw new BitcoinTipInputError("invalid_enabled");
  const minimumText = typeof input.minimumSats === "number" ? String(input.minimumSats) : typeof input.minimumSats === "string" ? input.minimumSats : "0";
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(minimumText)) throw new BitcoinTipInputError("invalid_minimum");
  const row = await input.database.prepare("SELECT visibility, verification_status FROM profile_wallet_accounts WHERE id = ? AND profile_id = ? AND namespace = 'bip122'")
    .bind(input.accountId, input.profileId).first<{ visibility: "private" | "public"; verification_status: string }>();
  if (!row) throw new BitcoinTipPermissionError("account_not_found");
  if (row.verification_status !== "verified") throw new BitcoinTipPermissionError("account_not_verified");
  const visibility = input.visibility === "public" || input.visibility === "private" ? input.visibility : row.visibility;
  // Enabling tips exposes the receiving address, so it must be public: the owner opts in explicitly.
  if (input.enabled && visibility !== "public") throw new BitcoinTipInputError("address_must_be_public_to_receive_tips");
  const now = new Date().toISOString();
  await input.database.prepare("UPDATE profile_wallet_accounts SET tips_enabled = ?, minimum_tip_raw = ?, visibility = ?, updated_at = ? WHERE id = ? AND profile_id = ?")
    .bind(input.enabled ? 1 : 0, minimumText, visibility, now, input.accountId, input.profileId).run();
  return { accountId: input.accountId, tipsEnabled: input.enabled, minimumSats: minimumText, visibility };
}

/** Public receiving addresses of a handle that explicitly enabled tips (verified + public + tips_enabled). */
export async function getBitcoinTipRecipient(database: D1Database, handleValue: unknown, chainRef: unknown) {
  const network = getBitcoinNetwork(chainRef);
  if (!network) throw new BitcoinTipInputError("unsupported_chain");
  const handle = typeof handleValue === "string" ? handleValue.trim().replace(/^@/, "") : "";
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(handle)) throw new BitcoinTipInputError("invalid_recipient");
  const rows = await database.prepare(`SELECT a.display_address address, a.minimum_tip_raw minimum
      FROM profiles p
      JOIN profile_wallet_accounts a ON a.profile_id = p.id AND a.namespace = 'bip122' AND a.verification_status = 'verified' AND a.tips_enabled = 1 AND a.visibility = 'public'
      JOIN wallet_account_networks n ON n.wallet_account_id = a.id AND n.network_reference = ? AND n.enabled = 1
      WHERE p.handle = ? LIMIT 5`).bind(network.chainRef, handle).all<{ address: string; minimum: string }>();
  if (rows.results.length === 0) return null;
  return { handle, chainRef: network.chainRef, network: network.name, addresses: rows.results.map((row) => ({ address: row.address, minimumSats: row.minimum })) };
}
