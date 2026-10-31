/*
 * Game-seller verification (owner decision 2026-10-29; docs/hub-software/SELLER-VERIFICATION.md).
 *
 * Executable builds may be published only by a creator who passed Commerce's seller verification (販売者確認).
 * Flow: Hub issues a one-time challenge bound to the signed-in profile (5 minutes) -> the browser sends it to
 * Commerce directly -> Commerce returns a signed proof of exactly {aud, purpose, challenge, verified, iat, exp,
 * jti} -> the browser posts the proof here. Hub verifies the signature (Commerce public key from config),
 * consumes the challenge for this profile only, rejects a replayed token ID, and records only the time and
 * a 180-day expiry. No Commerce seller ID, name, address, KYC data or wallet is ever received or stored.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { GameStoreError } from "@/lib/server/d1-game-store";
import type { VerifiedGameSellerProof } from "@/lib/server/game-seller-proof";

export const GAME_SELLER_CHALLENGE_TTL_MS = 5 * 60_000;
export const GAME_SELLER_VERIFICATION_DAYS = 180;

export type GameSellerVerificationStatus = { verified: boolean; verifiedAt: string | null; expiresAt: string | null };

function randomChallenge(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One live challenge per profile: asking again replaces the previous one. */
export async function issueGameSellerChallenge(
  database: D1Database,
  profileId: string,
  now = new Date(),
): Promise<{ challenge: string; expiresAt: string }> {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + GAME_SELLER_CHALLENGE_TTL_MS).toISOString();
  const challenge = randomChallenge();
  await database.prepare("DELETE FROM hub_game_seller_challenges WHERE profile_id = ? OR expires_at <= ?")
    .bind(profileId, issuedAt).run();
  await database.prepare("DELETE FROM hub_game_seller_proof_jtis WHERE expires_at <= ?").bind(issuedAt).run();
  await database.prepare(`INSERT INTO hub_game_seller_challenges (challenge, profile_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)`).bind(challenge, profileId, issuedAt, expiresAt).run();
  return { challenge, expiresAt };
}

/**
 * Consumes a signature-verified proof for this profile. Fails closed (GameStoreError) when the challenge is not
 * this profile's, is expired or already used, or when the token ID was seen before.
 */
export async function redeemGameSellerProof(
  database: D1Database,
  profileId: string,
  proof: VerifiedGameSellerProof,
  now = new Date(),
): Promise<GameSellerVerificationStatus> {
  const at = now.toISOString();
  const consumed = await database.prepare(`UPDATE hub_game_seller_challenges SET consumed_at = ?
      WHERE challenge = ? AND profile_id = ? AND consumed_at IS NULL AND expires_at > ?`)
    .bind(at, proof.challenge, profileId, at).run();
  if (Number(consumed.meta?.changes ?? 0) !== 1) throw new GameStoreError("invalid_seller_challenge", 409);
  const inserted = await database.prepare("INSERT INTO hub_game_seller_proof_jtis (jti, used_at, expires_at) VALUES (?, ?, ?)")
    .bind(proof.jti, at, new Date(proof.exp * 1000 + GAME_SELLER_CHALLENGE_TTL_MS).toISOString()).run()
    .then(() => true, () => false);
  if (!inserted) throw new GameStoreError("seller_proof_replayed", 409);
  const until = new Date(now.getTime() + GAME_SELLER_VERIFICATION_DAYS * 86_400_000).toISOString();
  await database.prepare(`INSERT INTO hub_game_seller_verifications (profile_id, game_seller_verified_at, game_seller_verified_until)
      VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET game_seller_verified_at = excluded.game_seller_verified_at,
        game_seller_verified_until = excluded.game_seller_verified_until`)
    .bind(profileId, at, until).run();
  return { verified: true, verifiedAt: at, expiresAt: until };
}

export async function getGameSellerVerification(
  database: D1Database,
  profileId: string,
  now = new Date(),
): Promise<GameSellerVerificationStatus> {
  const row = await database.prepare(`SELECT game_seller_verified_at AS verifiedAt, game_seller_verified_until AS expiresAt
      FROM hub_game_seller_verifications WHERE profile_id = ?`).bind(profileId).first<{ verifiedAt: string; expiresAt: string }>();
  if (!row || row.expiresAt <= now.toISOString()) return { verified: false, verifiedAt: row?.verifiedAt ?? null, expiresAt: row?.expiresAt ?? null };
  return { verified: true, verifiedAt: row.verifiedAt, expiresAt: row.expiresAt };
}
