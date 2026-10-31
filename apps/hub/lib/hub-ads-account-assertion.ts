export type HubAdsAccountAssertion = { sub: string; jti: string; exp: number };

const decode = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), (char) => char.charCodeAt(0));

export async function verifyHubAdsAccountAssertion(token: string, publicKeySpkiBase64: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<HubAdsAccountAssertion | null> {
  try {
    const parts = token.split("."); if (parts.length !== 3 || !publicKeySpkiBase64) return null;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Record<string, unknown>;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as Record<string, unknown>;
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(publicKeySpkiBase64), (char) => char.charCodeAt(0)), { name: "Ed25519" }, false, ["verify"]);
    if (!await crypto.subtle.verify("Ed25519", key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null;
    if (claims.iss !== "jkamma-account" || claims.aud !== "jkamma-hub-ads" || claims.purpose !== "ads_manage") return null;
    if (typeof claims.sub !== "string" || claims.sub.length < 32 || claims.sub.length > 128) return null;
    if (typeof claims.jti !== "string" || !/^[0-9a-f-]{36}$/i.test(claims.jti)) return null;
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || Number(claims.iat) > nowSeconds + 60
      || Number(claims.exp) <= nowSeconds || Number(claims.exp) - Number(claims.iat) > 180) return null;
    return { sub: claims.sub, jti: claims.jti, exp: Number(claims.exp) };
  } catch { return null; }
}
