export type VerifiedWorkTrustProjection = {
  version: 1;
  issuer: "jkamma-commerce";
  audience: "hub-creator-center";
  purpose: "work-completion-summary";
  jti: string;
  evidenceKey: string;
  role: "client" | "worker";
  completedAt: string;
  mutualReviewCompleted: boolean;
  ratingReceived: number | null;
  observedAt: string;
  expiresAt: string;
};

function decodeBase64(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)).buffer;
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return decodeBase64(normalized + "=".repeat((4 - normalized.length % 4) % 4));
}

function validClaims(claims: VerifiedWorkTrustProjection, now: Date): boolean {
  const allowed = new Set([
    "version", "issuer", "audience", "purpose", "jti", "evidenceKey", "role",
    "completedAt", "mutualReviewCompleted", "ratingReceived", "observedAt",
    "expiresAt",
  ]);
  const completedAt = Date.parse(claims.completedAt);
  const observedAt = Date.parse(claims.observedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  const ratingValid = claims.mutualReviewCompleted
    ? Number.isInteger(claims.ratingReceived)
      && Number(claims.ratingReceived) >= 1
      && Number(claims.ratingReceived) <= 5
    : claims.ratingReceived === null;
  return Object.keys(claims).every((key) => allowed.has(key))
    && claims.version === 1
    && claims.issuer === "jkamma-commerce"
    && claims.audience === "hub-creator-center"
    && claims.purpose === "work-completion-summary"
    && /^[0-9a-f-]{36}$/i.test(claims.jti)
    && /^[0-9a-f]{64}$/.test(claims.evidenceKey)
    && (claims.role === "client" || claims.role === "worker")
    && typeof claims.mutualReviewCompleted === "boolean"
    && ratingValid
    && Number.isFinite(completedAt)
    && Number.isFinite(observedAt)
    && Number.isFinite(expiresAt)
    && completedAt <= observedAt + 30_000
    && observedAt <= now.getTime() + 30_000
    && expiresAt > now.getTime()
    && expiresAt - observedAt <= 5 * 60 * 1000;
}

export async function verifyWorkTrustProof(
  proof: unknown,
  publicKeySpkiBase64: string,
  now = new Date(),
): Promise<VerifiedWorkTrustProjection | null> {
  if (typeof proof !== "string" || proof.length > 4_096 || !publicKeySpkiBase64)
    return null;
  const [header, payload, signature, extra] = proof.split(".");
  if (!header || !payload || !signature || extra) return null;
  try {
    const parsedHeader = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(header)),
    ) as { alg?: unknown; typ?: unknown };
    if (parsedHeader.alg !== "EdDSA" || parsedHeader.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey(
      "spki",
      decodeBase64(publicKeySpkiBase64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    if (!await crypto.subtle.verify(
      "Ed25519",
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    )) return null;
    const claims = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payload)),
    ) as VerifiedWorkTrustProjection;
    return validClaims(claims, now) ? claims : null;
  } catch {
    return null;
  }
}
