/*
 * Commerce game-entitlement proof (owner approved 2026-10-18; AGENTS.md Hub-audience entitlement proof,
 * docs/hub-software/PLAN.md §2.5).
 *
 * The browser asks Commerce directly (with its own order access token) and hands Hub only this
 * short-lived EdDSA proof. It carries exactly: the public content ID (the Commerce product ID the game
 * listing names), the granted scope, the payment-final status, issue time, expiry and a unique token ID.
 * Commerce keeps the token ID stable per order, so Hub can bind one order to one profile and recognise
 * a later "refunded" proof for the same order. No order ID, amount, wallet, account or payment data.
 * Anything else, a wrong audience, an expired or long-lived proof, or a missing key fails closed.
 */

export type VerifiedGameEntitlementProof = {
  jti: string;
  productId: string;
  scope: "all-builds";
  status: "payment_final" | "refunded";
  iat: number;
  exp: number;
};

export const GAME_ENTITLEMENT_AUDIENCE = "jkamma-hub-game";
export const GAME_ENTITLEMENT_MAX_LIFETIME_SECONDS = 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = new Set(["version", "iss", "aud", "purpose", "jti", "productId", "scope", "status", "iat", "exp"]);

const decode = (value: string) => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  (character) => character.charCodeAt(0),
);

export async function verifyGameEntitlementProof(
  proof: unknown,
  publicKeySpkiBase64: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedGameEntitlementProof | null> {
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
      || claims.aud !== GAME_ENTITLEMENT_AUDIENCE
      || claims.purpose !== "game-entitlement"
      || typeof claims.jti !== "string" || !UUID.test(claims.jti)
      || typeof claims.productId !== "string" || !UUID.test(claims.productId)
      || claims.scope !== "all-builds"
      || (claims.status !== "payment_final" && claims.status !== "refunded")
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || Number(claims.iat) > nowSeconds + 30
      || Number(claims.exp) <= nowSeconds
      || Number(claims.exp) - Number(claims.iat) > GAME_ENTITLEMENT_MAX_LIFETIME_SECONDS
    ) return null;
    return {
      jti: claims.jti.toLowerCase(),
      productId: claims.productId.toLowerCase(),
      scope: "all-builds",
      status: claims.status,
      iat: Number(claims.iat),
      exp: Number(claims.exp),
    };
  } catch {
    return null;
  }
}
