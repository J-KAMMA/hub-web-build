/**
 * Bitcoin wallet-link challenge and verification (design section 2.3), on the shared
 * `wallet_link_challenges_v2` table and `registerVerifiedAccount` of link-store.ts.
 *
 * Accepted proofs per address kind:
 *   p2pkh  -> BIP-137 header 27-34
 *   p2sh   -> BIP-322 full (single-key P2SH-P2WPKH) or BIP-137 header 35-38
 *   p2wpkh -> BIP-322 simple/full or BIP-137 header 39-42
 *   p2tr   -> BIP-322 key-path only; never legacy signmessage
 *   p2wsh  -> cannot link (watch-only / receive only)
 * The nonce is never stored, only its hash; the exact issued message is compared by SHA-256.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { BitcoinAddressError, parseBitcoinAddress, type ParsedBitcoinAddress } from "@/lib/chains/address/bitcoin";
import { bitcoinNetworkAvailable, getBitcoinNetwork } from "@/lib/chains/bitcoin-chain-registry";
import { registerVerifiedAccount, WalletLinkError, type IssuedChallenge, type VerifiedLink } from "./link-store";
import { verifyBip137 } from "./bitcoin-bip137";
import { verifyBip322 } from "./bitcoin-bip322";
import { buildBitcoinLinkMessage, parseBitcoinLinkMessage } from "./bitcoin-message";
import { newNonce, sha256Hex, WALLET_LINK_TTL_MS } from "./message";

type Env = Readonly<Record<string, string | undefined>>;
const MAX_CHALLENGES_PER_HOUR = 30;

function toLinkError(error: unknown): WalletLinkError {
  if (error instanceof BitcoinAddressError) {
    if (error.code === "wrong_network") return new WalletLinkError("wrong_network");
    if (error.code === "unsupported_script") return new WalletLinkError("address_cannot_sign");
    if (error.code === "unknown_network") return new WalletLinkError("unsupported_chain");
    return new WalletLinkError("malformed_address");
  }
  return error instanceof WalletLinkError ? error : new WalletLinkError("malformed_address");
}

function parseLinkable(chainRef: string, address: unknown): ParsedBitcoinAddress {
  let parsed: ParsedBitcoinAddress;
  try { parsed = parseBitcoinAddress(chainRef, address); } catch (error) { throw toLinkError(error); }
  // P2WSH (and anything multisig or script-path) can be watch-only but never linked.
  if (parsed.kind === "p2wsh") throw new WalletLinkError("address_cannot_sign");
  return parsed;
}

export async function issueBitcoinLinkChallenge(
  database: D1Database,
  input: { profileId: string; handle: string | null; chainRef: string; address: unknown; origin: string; env: Env; now?: Date },
): Promise<IssuedChallenge> {
  const network = getBitcoinNetwork(input.chainRef);
  if (!bitcoinNetworkAvailable(network, input.env)) throw new WalletLinkError("unsupported_chain");
  const parsed = parseLinkable(input.chainRef, input.address);
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
  const message = buildBitcoinLinkMessage({
    host: origin.host,
    origin: origin.origin,
    address: parsed.normalized,
    handle: input.handle,
    chainRef: input.chainRef,
    nonce,
    issuedAt,
    expiresAt,
    challengeId,
  });
  await database.batch([
    database.prepare("DELETE FROM wallet_link_challenges_v2 WHERE expires_at < ?").bind(new Date(now.getTime() - 86_400_000).toISOString()),
    database.prepare(`INSERT INTO wallet_link_challenges_v2
      (id, profile_id, namespace, chain_ref, normalized_address, nonce_hash, message_sha256, issued_at, expires_at)
      VALUES (?, ?, 'bip122', ?, ?, ?, ?, ?, ?)`)
      .bind(challengeId, input.profileId, input.chainRef, parsed.normalized, sha256Hex(nonce), sha256Hex(message), issuedAt, expiresAt),
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

function verifyForKind(parsed: ParsedBitcoinAddress, message: string, signature: string) {
  const legacy = () => verifyBip137(parsed, message, signature);
  const modern = () => verifyBip322(parsed, message, signature);
  switch (parsed.kind) {
    case "p2pkh": return legacy();
    case "p2tr": return modern(); // never legacy for taproot
    default: {
      const first = modern();
      return first.ok ? first : legacy();
    }
  }
}

export async function verifyBitcoinLink(
  database: D1Database,
  input: { profileId: string; challengeId: unknown; signature: unknown; signedMessage: unknown; env: Env; now?: Date },
): Promise<VerifiedLink> {
  if (typeof input.challengeId !== "string" || !/^wlc-[0-9a-f-]{36}$/.test(input.challengeId)) throw new WalletLinkError("challenge_not_found");
  const now = input.now ?? new Date();
  const row = await database
    .prepare(`SELECT id, profile_id, namespace, chain_ref, normalized_address, message_sha256, expires_at, used_at
      FROM wallet_link_challenges_v2 WHERE id = ? AND profile_id = ?`)
    .bind(input.challengeId, input.profileId)
    .first<ChallengeRow>();
  if (!row || row.namespace !== "bip122") throw new WalletLinkError("challenge_not_found");
  if (row.used_at) throw new WalletLinkError("challenge_used");
  if (Date.parse(row.expires_at) <= now.getTime()) throw new WalletLinkError("challenge_expired");
  if (!bitcoinNetworkAvailable(getBitcoinNetwork(row.chain_ref), input.env)) throw new WalletLinkError("unsupported_chain");

  const message = input.signedMessage;
  if (typeof message !== "string" || sha256Hex(message) !== row.message_sha256) {
    const parsedMessage = typeof message === "string" ? parseBitcoinLinkMessage(message) : null;
    if (parsedMessage && parsedMessage.chainRef !== row.chain_ref) throw new WalletLinkError("wrong_network");
    throw new WalletLinkError("message_mismatch");
  }
  if (typeof input.signature !== "string") throw new WalletLinkError("bad_signature");

  const parsed = parseLinkable(row.chain_ref, row.normalized_address);
  const result = verifyForKind(parsed, message, input.signature);
  if (!result.ok) throw new WalletLinkError("bad_signature");

  const usedAt = now.toISOString();
  const claim = await database
    .prepare("UPDATE wallet_link_challenges_v2 SET used_at = ? WHERE id = ? AND profile_id = ? AND used_at IS NULL")
    .bind(usedAt, row.id, input.profileId)
    .run();
  if (claim.meta.changes !== 1) throw new WalletLinkError("challenge_used");

  const { accountId } = await registerVerifiedAccount(database, {
    profileId: input.profileId,
    namespace: "bip122",
    chainRef: row.chain_ref,
    normalizedAddress: parsed.normalized,
    displayAddress: parsed.normalized,
    addressKind: parsed.kind,
    method: result.method,
    verifiedAt: usedAt,
  });
  return { accountId, address: parsed.normalized, chainRef: row.chain_ref };
}
