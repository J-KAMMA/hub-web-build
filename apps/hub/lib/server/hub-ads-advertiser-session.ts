import { createHmac, timingSafeEqual } from "node:crypto";

export const HUB_ADVERTISER_SESSION_COOKIE = "hub.ads.advertiser";
type Payload = { advertiserRef: string; issuedAt: number; expiresAt: number };

function secret() { const value = process.env.HUB_ADS_ADVERTISER_SESSION_SECRET; return value && value.length >= 32 ? value : null; }
function signature(encoded: string, key: string) { return createHmac("sha256", key).update(`hub-ads-advertiser-session-v1.${encoded}`).digest("base64url"); }

export function createHubAdsAdvertiserSession(advertiserRef: string, now = Date.now()) {
  const key = secret(); if (!key || !/^adv_[0-9a-f]{16}$/.test(advertiserRef)) return null;
  const encoded = Buffer.from(JSON.stringify({ advertiserRef, issuedAt: now, expiresAt: now + 60 * 60_000 } satisfies Payload)).toString("base64url");
  return `${encoded}.${signature(encoded, key)}`;
}

export function verifyHubAdsAdvertiserSession(token: string, now = Date.now()): Payload | null {
  const key = secret(); const [encoded, supplied, extra] = token.split(".");
  if (!key || !encoded || !supplied || extra) return null;
  const expected = Buffer.from(signature(encoded, key)); const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
    return /^adv_[0-9a-f]{16}$/.test(payload.advertiserRef) && Number.isInteger(payload.issuedAt)
      && Number.isInteger(payload.expiresAt) && now >= payload.issuedAt - 60_000 && now < payload.expiresAt
      && payload.expiresAt - payload.issuedAt === 60 * 60_000 ? payload : null;
  } catch { return null; }
}

export function advertiserSessionFromRequest(request: Request) {
  const value = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${HUB_ADVERTISER_SESSION_COOKIE}=`))?.slice(HUB_ADVERTISER_SESSION_COOKIE.length + 1);
  return value ? verifyHubAdsAdvertiserSession(value) : null;
}
