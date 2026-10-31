/**
 * Challenge issue and verification for non-EVM wallet links (design section 2). Solana is implemented here;
 * the Bitcoin lane plugs its verifiers into `verifyLink` through the same challenge table.
 *
 * Order of checks on verify: row by id AND profile, unexpired, unused, message bytes equal the issued bytes,
 * signature valid for the row's address, then a single-use UPDATE (`used_at IS NULL`, changes = 1), then the
 * account row. The nonce itself is never stored, only its hash.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { normalizeSolanaSignerAddress, SolanaAddressError } from "@/lib/chains/address/solana";
import { getSolanaChain, isSolanaChainActive } from "@/lib/chains/solana-chain-registry";
import {
  buildSolanaLinkMessage,
  newNonce,
  parseSolanaLinkMessage,
  sha256Hex,
  WALLET_LINK_TTL_MS,
} from "./message";
import { decodeSignatureBase64, verifySolanaMessageSignature } from "./solana-verify";

export type WalletLinkErrorCode =
  | "unsupported_chain"
  | "malformed_address"
  | "address_cannot_sign"
  | "rate_limited"
  | "challenge_not_found"
  | "challenge_expired"
  | "challenge_used"
  | "wrong_network"
  | "message_mismatch"
  | "bad_signature"
  | "wallet_linked_elsewhere";

export class WalletLinkError extends Error {
  constructor(readonly code: WalletLinkErrorCode) {
    super(code);
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const MAX_CHALLENGES_PER_HOUR = 30;

export type IssuedChallenge = { challengeId: string; message: string; expiresAt: string };

export async function issueSolanaLinkChallenge(
  database: D1Database,
  input: { profileId: string; handle: string | null; chainRef: string; address: unknown; origin: string; env: Env; now?: Date },
): Promise<IssuedChallenge> {
  if (!isSolanaChainActive(input.chainRef, input.env)) throw new WalletLinkError("unsupported_chain");
  const entry = getSolanaChain(input.chainRef)!;
  let address: string;
  try {
    address = normalizeSolanaSignerAddress(input.address).address;
  } catch (error) {
    if (error instanceof SolanaAddressError) throw new WalletLinkError(error.code);
    throw error;
  }
  const origin = new URL(input.origin);
  const now = input.now ?? new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + WALLET_LINK_TTL_MS).toISOString();

  const recent = await database
    .prepare("SELECT COUNT(*) AS n FROM wallet_link_challenges_v2 WHERE profile_id = ? AND issued_at > ?")
    .bind(input.profileId, new Date(now.getTime() - 3_600_000).toISOString())
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_CHALLENGES_PER_HOUR) throw new WalletLinkError("rate_limited");

  const challengeId = `wlc-${crypto.randomUUID()}`;
  const nonce = newNonce();
  const message = buildSolanaLinkMessage({
    host: origin.host,
    origin: origin.origin,
    address,
    handle: input.handle,
    cluster: entry.cluster,
    nonce,
    issuedAt,
    expiresAt,
    challengeId,
  });
  await database.batch([
    database.prepare("DELETE FROM wallet_link_challenges_v2 WHERE expires_at < ?").bind(new Date(now.getTime() - 86_400_000).toISOString()),
    database.prepare(`INSERT INTO wallet_link_challenges_v2
      (id, profile_id, namespace, chain_ref, normalized_address, nonce_hash, message_sha256, issued_at, expires_at)
      VALUES (?, ?, 'solana', ?, ?, ?, ?, ?, ?)`)
      .bind(challengeId, input.profileId, input.chainRef, address, sha256Hex(nonce), sha256Hex(message), issuedAt, expiresAt),
  ]);
  return { challengeId, message, expiresAt };
}

type ChallengeRow = {
  id: string;
  profile_id: string;
  namespace: string;
  chain_ref: string;
  normalized_address: string;
  message_sha256: string;
  expires_at: string;
  used_at: string | null;
};

export type VerifiedLink = { accountId: string; address: string; chainRef: string };

export async function verifySolanaLink(
  database: D1Database,
  input: { profileId: string; challengeId: unknown; signature: unknown; signedMessage: unknown; env: Env; now?: Date },
): Promise<VerifiedLink> {
  if (typeof input.challengeId !== "string" || !/^wlc-[0-9a-f-]{36}$/.test(input.challengeId)) {
    throw new WalletLinkError("challenge_not_found");
  }
  const now = input.now ?? new Date();
  const row = await database
    .prepare(`SELECT id, profile_id, namespace, chain_ref, normalized_address, message_sha256, expires_at, used_at
      FROM wallet_link_challenges_v2 WHERE id = ? AND profile_id = ?`)
    .bind(input.challengeId, input.profileId)
    .first<ChallengeRow>();
  if (!row || row.namespace !== "solana") throw new WalletLinkError("challenge_not_found");
  if (row.used_at) throw new WalletLinkError("challenge_used");
  if (Date.parse(row.expires_at) <= now.getTime()) throw new WalletLinkError("challenge_expired");
  if (!isSolanaChainActive(row.chain_ref, input.env)) throw new WalletLinkError("unsupported_chain");

  const message = input.signedMessage;
  if (typeof message !== "string" || sha256Hex(message) !== row.message_sha256) {
    // Tell a message built for another network apart from any other difference.
    const parsed = typeof message === "string" ? parseSolanaLinkMessage(message) : null;
    const expected = getSolanaChain(row.chain_ref)!;
    if (parsed && parsed.cluster !== expected.cluster) throw new WalletLinkError("wrong_network");
    throw new WalletLinkError("message_mismatch");
  }

  let publicKey: Uint8Array;
  try {
    publicKey = normalizeSolanaSignerAddress(row.normalized_address).publicKey;
  } catch {
    throw new WalletLinkError("malformed_address");
  }
  const signature = decodeSignatureBase64(input.signature);
  if (!signature || !verifySolanaMessageSignature(message, signature, publicKey)) throw new WalletLinkError("bad_signature");

  const usedAt = now.toISOString();
  const claim = await database
    .prepare("UPDATE wallet_link_challenges_v2 SET used_at = ? WHERE id = ? AND profile_id = ? AND used_at IS NULL")
    .bind(usedAt, row.id, input.profileId)
    .run();
  if (claim.meta.changes !== 1) throw new WalletLinkError("challenge_used");

  const { accountId } = await registerVerifiedAccount(database, {
    profileId: input.profileId,
    namespace: "solana",
    chainRef: row.chain_ref,
    normalizedAddress: row.normalized_address,
    displayAddress: row.normalized_address,
    addressKind: "ed25519",
    method: "siws_ed25519",
    verifiedAt: usedAt,
  });
  return { accountId, address: row.normalized_address, chainRef: row.chain_ref };
}

export type VerifiedAccountInput = {
  profileId: string;
  namespace: "solana" | "bip122";
  chainRef: string;
  normalizedAddress: string;
  displayAddress: string;
  addressKind: string;
  method: "siws_ed25519" | "bip322_simple" | "bip322_full" | "bip137_legacy";
  verifiedAt: string;
};

/**
 * Records a signature-verified account. Only VERIFIED rows claim an address (migration 0306): another profile's
 * watch-only row never blocks the link, and this profile's own row is upgraded in place. A different profile
 * that already verified the address gets `wallet_linked_elsewhere` without any hint of which profile.
 */
export async function registerVerifiedAccount(database: D1Database, input: VerifiedAccountInput): Promise<{ accountId: string }> {
  const claimed = await database
    .prepare("SELECT id, profile_id FROM profile_wallet_accounts WHERE namespace = ? AND normalized_address = ? AND verification_status = 'verified' LIMIT 1")
    .bind(input.namespace, input.normalizedAddress)
    .first<{ id: string; profile_id: string }>();
  if (claimed && claimed.profile_id !== input.profileId) throw new WalletLinkError("wallet_linked_elsewhere");
  const own = claimed ?? await database
    .prepare("SELECT id, profile_id FROM profile_wallet_accounts WHERE namespace = ? AND normalized_address = ? AND profile_id = ? LIMIT 1")
    .bind(input.namespace, input.normalizedAddress, input.profileId)
    .first<{ id: string; profile_id: string }>();

  const accountId = own?.id ?? `wallet-account-${crypto.randomUUID()}`;
  const at = input.verifiedAt;
  try {
    await database.batch([
      own
        ? database.prepare(`UPDATE profile_wallet_accounts SET display_address = ?, address_kind = ?, verification_status = 'verified',
            verification_method = ?, verified_at = ?, updated_at = ? WHERE id = ? AND profile_id = ?`)
          .bind(input.displayAddress, input.addressKind, input.method, at, at, accountId, input.profileId)
        : database.prepare(`INSERT INTO profile_wallet_accounts
            (id, profile_id, namespace, normalized_address, display_address, address_kind, verification_status, verification_method, verified_at, visibility, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?, 'private', ?, ?)`)
          .bind(accountId, input.profileId, input.namespace, input.normalizedAddress, input.displayAddress, input.addressKind, input.method, at, at, at),
      database.prepare(`INSERT INTO wallet_account_networks (wallet_account_id, network_reference, enabled, created_at)
        VALUES (?, ?, 1, ?) ON CONFLICT(wallet_account_id, network_reference) DO UPDATE SET enabled = 1`)
        .bind(accountId, input.chainRef, at),
    ]);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new WalletLinkError("wallet_linked_elsewhere");
    throw error;
  }
  return { accountId };
}
