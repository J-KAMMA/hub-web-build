import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export interface HubAdMeasurementTokenPayload {
  tokenId: string;
  requestId: string;
  placementId: string;
  lineItemId: string;
  creativeVersionId: string;
  issuedAt: number;
  expiresAt: number;
}

function configuredSecret(): string | null {
  const value = process.env.HUB_ADS_MEASUREMENT_SECRET;
  return value && value.length >= 32 ? value : null;
}

function signature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(`hub-ads-measurement-v1.${encodedPayload}`).digest("base64url");
}

export function createHubAdMeasurementToken(payload: HubAdMeasurementTokenPayload): string | null {
  const secret = configuredSecret();
  if (!secret) return null;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifyHubAdMeasurementToken(token: string, now = Date.now()): HubAdMeasurementTokenPayload | null {
  const secret = configuredSecret();
  const [encodedPayload, suppliedSignature, extra] = token.split(".");
  if (!secret || !encodedPayload || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(encodedPayload, secret));
  const actual = Buffer.from(suppliedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as HubAdMeasurementTokenPayload;
    if (!payload || typeof payload !== "object" || !payload.tokenId || !payload.requestId || !payload.placementId
      || !payload.lineItemId || !payload.creativeVersionId || !Number.isInteger(payload.issuedAt)
      || !Number.isInteger(payload.expiresAt) || now < payload.issuedAt - 60_000 || now >= payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashHubAdFrequencyBucket(rawToken: string): string | null {
  const secret = configuredSecret();
  return secret ? createHmac("sha256", secret).update(`hub-ads-frequency-v1.${rawToken}`).digest("base64url") : null;
}
