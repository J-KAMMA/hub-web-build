/**
 * Solana tips (design section 5). Native SOL only, verified on chain by the server:
 *
 *  - `getTransaction(signature, finalized, jsonParsed, maxSupportedTransactionVersion 0)`; a transaction that is not
 *    found at finalized commitment is `pending` and stores nothing.
 *  - `meta.err` must be null.
 *  - Only TOP-LEVEL System Program `transfer` instructions count. Inner (CPI) instructions are ignored.
 *  - `source` must be a verified Solana address of the authenticated sender (derived server-side from verified links;
 *    nothing about the sender comes from the client); `destination` must be a tip-enabled, public, verified address of
 *    the recipient; lamports must be a positive integer, and the sum to one destination must reach that address's minimum.
 *  - The destination's balance must have risen by at least that amount.
 *  - `UNIQUE(chain_ref, tx_ref)` blocks reuse; sender and recipient profiles differ; no sender address is stored.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { normalizeSolanaAddress, normalizeSolanaSignature } from "@/lib/chains/address/solana";
import { getSolanaChain, resolveSolanaRpc } from "@/lib/chains/solana-chain-registry";

export class SolanaTipInputError extends Error {}
export class SolanaTipPermissionError extends Error {}
export class SolanaTipVerificationError extends Error {}
export class SolanaTipUnavailableError extends Error {}

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const TIP_RPC_TIMEOUT_MS = 8_000;
const HANDLE = /^[A-Za-z0-9_.-]{1,64}$/;

export type SolanaTipDeps = {
  fetch: typeof fetch;
  env: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
};

type ParsedInstruction = {
  programId?: unknown;
  program?: unknown;
  parsed?: { type?: unknown; info?: { source?: unknown; destination?: unknown; lamports?: unknown } };
};

type ParsedTransaction = {
  slot?: unknown;
  meta?: { err?: unknown; preBalances?: unknown; postBalances?: unknown } | null;
  transaction?: {
    signatures?: unknown;
    message?: { accountKeys?: unknown; instructions?: unknown };
  };
};

export type SolanaTipCheck =
  | { state: "pending" }
  | { state: "confirmed"; destination: string; lamports: bigint };

function accountKeyAt(keys: unknown[], index: number): string | null {
  const entry = keys[index] as { pubkey?: unknown } | string | undefined;
  if (typeof entry === "string") return entry;
  return entry && typeof entry.pubkey === "string" ? entry.pubkey : null;
}

/** Pure check of a getTransaction result against the sender's and the recipient's addresses. */
export function checkSolanaTip(input: {
  signature: string;
  transaction: unknown;
  senderAddresses: ReadonlySet<string>;
  recipients: ReadonlyMap<string, bigint>;
}): SolanaTipCheck {
  if (input.transaction === null || input.transaction === undefined) return { state: "pending" };
  const tx = input.transaction as ParsedTransaction;
  if (typeof tx !== "object" || !tx.meta || typeof tx.meta !== "object" || !tx.transaction?.message) {
    throw new SolanaTipUnavailableError("rpc_malformed");
  }
  if (tx.meta.err !== null) throw new SolanaTipVerificationError("transaction_failed");
  const signatures = tx.transaction.signatures;
  if (!Array.isArray(signatures) || !signatures.includes(input.signature)) throw new SolanaTipVerificationError("signature_mismatch");
  const instructions = tx.transaction.message.instructions;
  const keys = tx.transaction.message.accountKeys;
  const pre = tx.meta.preBalances;
  const post = tx.meta.postBalances;
  if (!Array.isArray(instructions) || !Array.isArray(keys) || !Array.isArray(pre) || !Array.isArray(post)) {
    throw new SolanaTipUnavailableError("rpc_malformed");
  }

  const sums = new Map<string, bigint>();
  for (const item of instructions as ParsedInstruction[]) {
    if (!item || item.programId !== SYSTEM_PROGRAM_ID || item.parsed?.type !== "transfer") continue;
    const info = item.parsed.info;
    if (!info || typeof info.source !== "string" || typeof info.destination !== "string") continue;
    if (!input.senderAddresses.has(info.source) || !input.recipients.has(info.destination)) continue;
    const lamports = info.lamports;
    if (typeof lamports !== "number" || !Number.isSafeInteger(lamports) || lamports <= 0) continue;
    sums.set(info.destination, (sums.get(info.destination) ?? BigInt(0)) + BigInt(lamports));
  }

  let best: { destination: string; lamports: bigint } | null = null;
  for (const [destination, lamports] of sums) {
    if (lamports < (input.recipients.get(destination) ?? BigInt(0))) continue;
    const index = keys.findIndex((_, i) => accountKeyAt(keys, i) === destination);
    if (index < 0) continue;
    const before = pre[index];
    const after = post[index];
    if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || BigInt(after as number) - BigInt(before as number) < lamports) continue;
    if (!best || lamports > best.lamports) best = { destination, lamports };
  }
  if (!best) throw new SolanaTipVerificationError("no_matching_transfer");
  return { state: "confirmed", ...best };
}

async function fetchTransaction(deps: SolanaTipDeps, url: string, signature: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIP_RPC_TIMEOUT_MS);
  try {
    const response = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { commitment: "finalized", maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new SolanaTipUnavailableError("rpc_error");
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (!body || typeof body !== "object" || body.error || !("result" in body)) throw new SolanaTipUnavailableError("rpc_error");
    return body.result;
  } catch (error) {
    if (error instanceof SolanaTipUnavailableError) throw error;
    throw new SolanaTipUnavailableError("rpc_error");
  } finally {
    clearTimeout(timer);
  }
}

function minimumOf(raw: string): bigint {
  return /^[0-9]{1,30}$/.test(raw) ? BigInt(raw) : BigInt(0);
}

export type ConfirmSolanaTipInput = {
  database: D1Database;
  senderProfileId: string;
  chainRef: unknown;
  signature: unknown;
  recipientHandle: unknown;
  deps?: SolanaTipDeps;
};

export type ConfirmSolanaTipResult =
  | { status: "pending"; signature: string }
  | { status: "confirmed"; signature: string; amountLamports: string };

export async function confirmSolanaTip(input: ConfirmSolanaTipInput): Promise<ConfirmSolanaTipResult> {
  const deps: SolanaTipDeps = input.deps ?? { fetch: (url, init) => fetch(url, init), env: process.env };
  const entry = typeof input.chainRef === "string" ? getSolanaChain(input.chainRef) : null;
  if (!entry) throw new SolanaTipInputError("unsupported_chain");
  const rpc = resolveSolanaRpc(entry.chainRef, deps.env);
  if (!rpc.ok) {
    if (rpc.reason === "unsupported_chain") throw new SolanaTipInputError("unsupported_chain");
    throw new SolanaTipUnavailableError("rpc_not_configured");
  }
  const signature = normalizeSolanaSignature(input.signature);
  if (!signature) throw new SolanaTipInputError("invalid_signature");
  const handle = typeof input.recipientHandle === "string" ? input.recipientHandle.trim().replace(/^@/, "") : "";
  if (!HANDLE.test(handle)) throw new SolanaTipInputError("invalid_recipient");

  const recipient = await input.database.prepare("SELECT id FROM profiles WHERE handle = ? LIMIT 1").bind(handle).first<{ id: string }>();
  if (!recipient) throw new SolanaTipPermissionError("recipient_not_enabled");
  if (recipient.id === input.senderProfileId) throw new SolanaTipPermissionError("self_tip");

  const targets = await input.database.prepare(`SELECT id, normalized_address, minimum_tip_raw FROM profile_wallet_accounts
      WHERE profile_id = ? AND namespace = 'solana' AND verification_status = 'verified' AND tips_enabled = 1 AND visibility = 'public' LIMIT 50`)
    .bind(recipient.id).all<{ id: string; normalized_address: string; minimum_tip_raw: string }>();
  if (targets.results.length === 0) throw new SolanaTipPermissionError("recipient_not_enabled");
  const senders = await input.database.prepare(`SELECT normalized_address FROM profile_wallet_accounts
      WHERE profile_id = ? AND namespace = 'solana' AND verification_status = 'verified' LIMIT 50`)
    .bind(input.senderProfileId).all<{ normalized_address: string }>();
  if (senders.results.length === 0) throw new SolanaTipVerificationError("sender_has_no_verified_address");

  const duplicate = await input.database.prepare("SELECT id FROM wallet_tip_transfers WHERE chain_ref = ? AND tx_ref = ?")
    .bind(entry.chainRef, signature).first<{ id: string }>();
  if (duplicate) throw new SolanaTipVerificationError("already_recorded");

  const recipients = new Map<string, bigint>();
  const accountByAddress = new Map<string, string>();
  for (const row of targets.results) {
    if (!normalizeSolanaAddress(row.normalized_address)) continue;
    recipients.set(row.normalized_address, minimumOf(row.minimum_tip_raw));
    accountByAddress.set(row.normalized_address, row.id);
  }
  const checked = checkSolanaTip({
    signature,
    transaction: await fetchTransaction(deps, rpc.url, signature),
    senderAddresses: new Set(senders.results.map((row) => row.normalized_address)),
    recipients,
  });
  if (checked.state === "pending") return { status: "pending", signature };

  const now = (deps.now?.() ?? new Date()).toISOString();
  try {
    await input.database.prepare(`INSERT INTO wallet_tip_transfers
        (id, chain_ref, tx_ref, asset_ref, amount_raw, sender_profile_id, recipient_profile_id, recipient_wallet_account_id, confirmed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`tip-${crypto.randomUUID()}`, entry.chainRef, signature, `${entry.chainRef}/slip44:501`, checked.lamports.toString(),
        input.senderProfileId, recipient.id, accountByAddress.get(checked.destination) ?? null, now, now)
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new SolanaTipVerificationError("already_recorded");
    throw error;
  }
  return { status: "confirmed", signature, amountLamports: checked.lamports.toString() };
}

/** Own settings for a verified Solana account: enable tips, set the minimum (lamports) and visibility. Verified rows only. */
export async function updateSolanaTipSettings(input: {
  database: D1Database;
  profileId: string;
  accountId: unknown;
  enabled: unknown;
  minimumLamports: unknown;
  visibility?: unknown;
}): Promise<{ accountId: string; tipsEnabled: boolean; minimumLamports: string; visibility: "private" | "public" }> {
  if (typeof input.accountId !== "string" || !/^[0-9a-z-]{10,80}$/i.test(input.accountId)) throw new SolanaTipInputError("invalid_account");
  if (typeof input.enabled !== "boolean") throw new SolanaTipInputError("invalid_enabled");
  const minimumText = typeof input.minimumLamports === "number" ? String(input.minimumLamports)
    : typeof input.minimumLamports === "string" ? input.minimumLamports : "0";
  if (!/^(?:0|[1-9][0-9]{0,18})$/.test(minimumText)) throw new SolanaTipInputError("invalid_minimum");
  const row = await input.database.prepare("SELECT visibility, verification_status FROM profile_wallet_accounts WHERE id = ? AND profile_id = ? AND namespace = 'solana'")
    .bind(input.accountId, input.profileId).first<{ visibility: "private" | "public"; verification_status: string }>();
  if (!row) throw new SolanaTipPermissionError("account_not_found");
  if (row.verification_status !== "verified") throw new SolanaTipPermissionError("account_not_verified");
  const visibility = input.visibility === "public" || input.visibility === "private" ? input.visibility : row.visibility;
  // Enabling tips exposes the receiving address, so it must be public: the owner opts in explicitly.
  if (input.enabled && visibility !== "public") throw new SolanaTipInputError("address_must_be_public_to_receive_tips");
  const now = new Date().toISOString();
  await input.database.prepare("UPDATE profile_wallet_accounts SET tips_enabled = ?, minimum_tip_raw = ?, visibility = ?, updated_at = ? WHERE id = ? AND profile_id = ?")
    .bind(input.enabled ? 1 : 0, minimumText, visibility, now, input.accountId, input.profileId).run();
  return { accountId: input.accountId, tipsEnabled: input.enabled, minimumLamports: minimumText, visibility };
}

/** Public receiving addresses of a handle that explicitly enabled tips (verified + public + tips_enabled). */
export async function getSolanaTipRecipient(database: D1Database, handleValue: unknown, chainRef: unknown) {
  const entry = typeof chainRef === "string" ? getSolanaChain(chainRef) : null;
  if (!entry) throw new SolanaTipInputError("unsupported_chain");
  const handle = typeof handleValue === "string" ? handleValue.trim().replace(/^@/, "") : "";
  if (!HANDLE.test(handle)) throw new SolanaTipInputError("invalid_recipient");
  const rows = await database.prepare(`SELECT a.display_address address, a.minimum_tip_raw minimum
      FROM profiles p
      JOIN profile_wallet_accounts a ON a.profile_id = p.id AND a.namespace = 'solana' AND a.verification_status = 'verified' AND a.tips_enabled = 1 AND a.visibility = 'public'
      WHERE p.handle = ? LIMIT 5`).bind(handle).all<{ address: string; minimum: string }>();
  if (rows.results.length === 0) return null;
  return { handle, chainRef: entry.chainRef, network: entry.name, addresses: rows.results.map((row) => ({ address: row.address, minimumLamports: row.minimum })) };
}
