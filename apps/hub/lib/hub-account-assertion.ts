export type HubAccountAssertion = { sub: string; jti: string; exp: number };

const MAX_ASSERTION_LENGTH = 4096;
const MAX_HEADER_SEGMENT_LENGTH = 512;
const MAX_CLAIMS_SEGMENT_LENGTH = 2048;
const MAX_SIGNATURE_SEGMENT_LENGTH = 128;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const HUB_PAIRWISE_SUBJECT = /^[A-Za-z0-9_-]{43}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const decode = (value: string) => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  (character) => character.charCodeAt(0)
);

function isBoundedBase64UrlSegment(value: string, maximumLength: number): boolean {
  return value.length > 0
    && value.length <= maximumLength
    && value.length % 4 !== 1
    && BASE64URL_SEGMENT.test(value);
}

export async function verifyHubAccountAssertion(
  token: string,
  publicKeySpkiBase64: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<HubAccountAssertion | null> {
  try {
    if (token.length === 0 || token.length > MAX_ASSERTION_LENGTH) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !publicKeySpkiBase64) return null;
    if (!isBoundedBase64UrlSegment(parts[0], MAX_HEADER_SEGMENT_LENGTH)
      || !isBoundedBase64UrlSegment(parts[1], MAX_CLAIMS_SEGMENT_LENGTH)
      || !isBoundedBase64UrlSegment(parts[2], MAX_SIGNATURE_SEGMENT_LENGTH)) return null;
    const signature = decode(parts[2]);
    if (signature.byteLength !== 64) return null;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Record<string, unknown>;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as Record<string, unknown>;
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(publicKeySpkiBase64), (character) => character.charCodeAt(0)),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "Ed25519",
      key,
      signature,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;
    if (claims.iss !== "jkamma-account" || claims.aud !== "jkamma-hub" || claims.purpose !== "hub_login") return null;
    if (typeof claims.sub !== "string" || !HUB_PAIRWISE_SUBJECT.test(claims.sub)) return null;
    if (typeof claims.jti !== "string" || !CANONICAL_UUID.test(claims.jti)) return null;
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return null;
    if (Number(claims.iat) > nowSeconds + 60
      || Number(claims.exp) <= nowSeconds
      || Number(claims.exp) <= Number(claims.iat)
      || Number(claims.exp) - Number(claims.iat) > 180) return null;
    return { sub: claims.sub, jti: claims.jti, exp: Number(claims.exp) };
  } catch {
    return null;
  }
}
