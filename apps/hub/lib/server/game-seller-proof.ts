/*
 * Commerce game-seller verification proof (owner decision 2026-10-29; docs/hub-software/SELLER-VERIFICATION.md).
 *
 * The creator's browser asks Commerce directly (with its own seller session) and hands Hub only this
 * short-lived EdDSA proof. It carries exactly: audience, purpose, the challenge Hub issued, verified:true,
 * issue time, expiry and a unique token ID. No seller or account ID, name, address, KYC data or wallet.
 * Same Commerce key and mechanism as the game entitlement proof; a different audience and purpose keep
 * the two from being exchanged. Anything else, an expired or long-lived proof, or a missing key fails closed.
 */

export type VerifiedGameSellerProof = {
  jti: string;
  challenge: string;
  iat: number;
  exp: number;
};

export const GAME_SELLER_PROOF_AUDIENCE = "jkamma-hub";
export const GAME_SELLER_PROOF_PURPOSE = "game-seller-verified";
export const GAME_SELLER_PROOF_MAX_LIFETIME_SECONDS = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHALLENGE = /^[0-9a-f]{64}$/;
const ALLOWED = new Set(["version", "iss", "aud", "purpose", "jti", "challenge", "verified", "iat", "exp"]);

const decode = (value: string) => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  (character) => character.charCodeAt(0),
);

export async function verifyGameSellerProof(
  proof: unknown,
  publicKeySpkiBase64: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedGameSellerProof | null> {
  const publicKey = publicKeySpkiBase64?.trim();
  if (!publicKey || typeof proof !== "string" || proof.length > 4_096) return null;
  const parts = proof.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Record<string, unknown>;
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(publicKey), (character) => character.charCodeAt(0)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    if (!await crypto.subtle.verify("Ed25519", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as Record<string, unknown>;
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    if (!Object.keys(claims).every((name) => ALLOWED.has(name))) return null;
    if (
      claims.version !== 1
      || claims.iss !== "jkamma-commerce"
      || claims.aud !== GAME_SELLER_PROOF_AUDIENCE
      || claims.purpose !== GAME_SELLER_PROOF_PURPOSE
      || claims.verified !== true
      || typeof claims.jti !== "string" || !UUID.test(claims.jti)
      || typeof claims.challenge !== "string" || !CHALLENGE.test(claims.challenge)
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || Number(claims.iat) > nowSeconds + 30
      || Number(claims.exp) <= nowSeconds
      || Number(claims.exp) - Number(claims.iat) > GAME_SELLER_PROOF_MAX_LIFETIME_SECONDS
    ) return null;
    return {
      jti: claims.jti.toLowerCase(),
      challenge: claims.challenge,
      iat: Number(claims.iat),
      exp: Number(claims.exp),
    };
  } catch {
    return null;
  }
}
