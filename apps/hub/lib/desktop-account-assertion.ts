export type DesktopSessionAssertion = { sub: string; deviceId: string; jti: string; exp: number };
export type DesktopLinkAssertion = DesktopSessionAssertion & { hubSub: string };

const MAX_ASSERTION_LENGTH = 4096;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SUBJECT = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const decode = (value: string) => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  (character) => character.charCodeAt(0),
);

async function verifiedClaims(token: string, publicKeySpkiBase64: string, nowSeconds: number) {
  try {
    if (!token || token.length > MAX_ASSERTION_LENGTH) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every((part) => part.length > 0 && part.length <= 2048 && part.length % 4 !== 1 && BASE64URL.test(part))) return null;
    const signature = decode(parts[2]);
    if (signature.byteLength !== 64) return null;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Record<string, unknown>;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as Record<string, unknown>;
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey(
      "spki", Uint8Array.from(atob(publicKeySpkiBase64), (character) => character.charCodeAt(0)),
      { name: "Ed25519" }, false, ["verify"],
    );
    if (!await crypto.subtle.verify("Ed25519", key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null;
    if (claims.iss !== "jkamma-account" || typeof claims.sub !== "string" || !SUBJECT.test(claims.sub)
      || typeof claims.device_id !== "string" || !UUID.test(claims.device_id)
      || typeof claims.jti !== "string" || !UUID.test(claims.jti)
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || Number(claims.iat) > nowSeconds + 60 || Number(claims.exp) <= nowSeconds
      || Number(claims.exp) <= Number(claims.iat) || Number(claims.exp) - Number(claims.iat) > 180) return null;
    return claims;
  } catch { return null; }
}

export async function verifyDesktopSessionAssertion(
  token: string, publicKeySpkiBase64: string, nowSeconds = Math.floor(Date.now() / 1000),
): Promise<DesktopSessionAssertion | null> {
  const claims = await verifiedClaims(token, publicKeySpkiBase64, nowSeconds);
  if (!claims || claims.aud !== "jkamma-hub-desktop" || claims.purpose !== "desktop_hub_session") return null;
  return { sub: claims.sub as string, deviceId: claims.device_id as string, jti: claims.jti as string, exp: Number(claims.exp) };
}

export async function verifyDesktopLinkAssertion(
  token: string, publicKeySpkiBase64: string, nowSeconds = Math.floor(Date.now() / 1000),
): Promise<DesktopLinkAssertion | null> {
  const claims = await verifiedClaims(token, publicKeySpkiBase64, nowSeconds);
  if (!claims || claims.aud !== "jkamma-hub-desktop-link" || claims.purpose !== "desktop_profile_link"
    || typeof claims.hub_sub !== "string" || !SUBJECT.test(claims.hub_sub)) return null;
  return { sub: claims.sub as string, hubSub: claims.hub_sub, deviceId: claims.device_id as string,
    jti: claims.jti as string, exp: Number(claims.exp) };
}
