import {
  safeCheckpointSummary,
  type HubIntentOwnerResult,
} from "@/lib/platform/intent-orchestrator";

export type VerifiedIntentOwnerResult = HubIntentOwnerResult & {
  version: 1;
  issuer: "jkamma-ai" | "jkamma-commerce";
  audience: "jkamma-hub-intent";
  purpose: "intent-owner-result";
  jti: string;
  intentRunId: string;
  stage: "discovery" | "fulfillment";
  iat: number;
  exp: number;
};

const decode = (value: string) => Uint8Array.from(
  atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")),
  (character) => character.charCodeAt(0),
);

export async function verifyIntentOwnerResultProof(
  proof: unknown,
  publicKeys: Partial<Record<"jkamma-ai" | "jkamma-commerce", string>>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedIntentOwnerResult | null> {
  if (typeof proof !== "string" || proof.length > 6_144) return null;
  const parts = proof.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as Record<string, unknown>;
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))) as Record<string, unknown>;
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const issuer = claims.iss;
    if (issuer !== "jkamma-ai" && issuer !== "jkamma-commerce") return null;
    const publicKey = publicKeys[issuer]?.trim();
    if (!publicKey) return null;
    const key = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(atob(publicKey), (character) => character.charCodeAt(0)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    if (!await crypto.subtle.verify(
      "Ed25519",
      key,
      decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )) return null;
    const allowed = new Set([
      "version", "iss", "aud", "purpose", "jti", "intentRunId", "stage",
      "status", "operationRef", "safeSummary", "iat", "exp",
    ]);
    if (!Object.keys(claims).every((name) => allowed.has(name))) return null;
    if (
      claims.version !== 1
      || claims.aud !== "jkamma-hub-intent"
      || claims.purpose !== "intent-owner-result"
      || typeof claims.jti !== "string"
      || !/^[0-9a-f-]{36}$/i.test(claims.jti)
      || typeof claims.intentRunId !== "string"
      || !/^[0-9a-f-]{36}$/i.test(claims.intentRunId)
      || (claims.stage !== "discovery" && claims.stage !== "fulfillment")
      || (claims.status !== "fulfilled" && claims.status !== "failed")
      || typeof claims.operationRef !== "string"
      || !/^[A-Za-z0-9_-]{8,160}$/.test(claims.operationRef)
      || !Number.isInteger(claims.iat)
      || !Number.isInteger(claims.exp)
      || Number(claims.iat) > nowSeconds + 30
      || Number(claims.exp) <= nowSeconds
      || Number(claims.exp) - Number(claims.iat) > 180
      || claims.safeSummary === null
      || typeof claims.safeSummary !== "object"
      || Array.isArray(claims.safeSummary)
    ) return null;
    const safeSummary = safeCheckpointSummary(
      claims.safeSummary as Record<string, string | number | boolean | null>,
    );
    return {
      version: 1,
      issuer,
      audience: "jkamma-hub-intent",
      purpose: "intent-owner-result",
      jti: claims.jti,
      intentRunId: claims.intentRunId,
      stage: claims.stage,
      service: issuer === "jkamma-ai" ? "ai" : "commerce",
      status: claims.status,
      operationRef: claims.operationRef,
      safeSummary,
      iat: Number(claims.iat),
      exp: Number(claims.exp),
    };
  } catch {
    return null;
  }
}
