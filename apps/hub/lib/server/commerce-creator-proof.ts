export type VerifiedCommerceCreatorProjection = {
  version: 1;
  issuer: "jkamma-commerce";
  audience: "hub-creator-center";
  purpose: "creator-transaction-summary";
  jti: string;
  orders: number;
  settledSalesJpyc: number;
  refundedJpyc: number;
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

function validClaims(
  claims: VerifiedCommerceCreatorProjection,
  now: Date,
): boolean {
  const allowed = new Set([
    "version",
    "issuer",
    "audience",
    "purpose",
    "jti",
    "orders",
    "settledSalesJpyc",
    "refundedJpyc",
    "observedAt",
    "expiresAt",
  ]);
  const observedAt = Date.parse(claims.observedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  return Object.keys(claims).every((key) => allowed.has(key))
    && claims.version === 1
    && claims.issuer === "jkamma-commerce"
    && claims.audience === "hub-creator-center"
    && claims.purpose === "creator-transaction-summary"
    && /^[0-9a-f-]{36}$/i.test(claims.jti)
    && [claims.orders, claims.settledSalesJpyc, claims.refundedJpyc]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
    && Number.isFinite(observedAt)
    && Number.isFinite(expiresAt)
    && observedAt <= now.getTime() + 30_000
    && expiresAt > now.getTime()
    && expiresAt - observedAt <= 5 * 60 * 1000;
}

export async function verifyCommerceCreatorProof(
  proof: unknown,
  publicKeySpkiBase64: string,
  now = new Date(),
): Promise<VerifiedCommerceCreatorProjection | null> {
  if (
    typeof proof !== "string"
    || proof.length > 4_096
    || !publicKeySpkiBase64
  ) return null;
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
    ) as VerifiedCommerceCreatorProjection;
    return validClaims(claims, now) ? claims : null;
  } catch {
    return null;
  }
}
