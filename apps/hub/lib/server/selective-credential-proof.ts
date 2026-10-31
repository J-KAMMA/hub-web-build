export type HubSelectiveCredential = {
  issuer: "jkamma-identity";
  audience: "jkamma-hub";
  purpose: "selective_credential";
  credentialType: "adult_verified" | "seller_verified";
  challenge: string;
  jti: string;
  issuedAt: number;
  expiresAt: number;
};

function decode(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)),
    (character) => character.charCodeAt(0),
  ).buffer;
}

export async function verifySelectiveCredentialProof(
  proof: unknown,
  expectedChallenge: string,
  publicKeySpkiBase64: string,
  now = new Date(),
): Promise<HubSelectiveCredential | null> {
  if (typeof proof !== "string" || proof.length > 4_096 || !publicKeySpkiBase64)
    return null;
  const [headerPart, payloadPart, signaturePart, extra] = proof.split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(headerPart))) as {
      alg?: unknown; typ?: unknown;
    };
    if (header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const raw = JSON.parse(new TextDecoder().decode(decode(payloadPart))) as Record<string, unknown>;
    const allowed = new Set([
      "iss", "aud", "purpose", "credential_type", "verified",
      "challenge", "iat", "exp", "jti",
    ]);
    if (!Object.keys(raw).every((key) => allowed.has(key))) return null;
    const current = Math.floor(now.getTime() / 1000);
    if (
      raw.iss !== "jkamma-identity"
      || raw.aud !== "jkamma-hub"
      || raw.purpose !== "selective_credential"
      || !["adult_verified", "seller_verified"].includes(String(raw.credential_type))
      || raw.verified !== true
      || raw.challenge !== expectedChallenge
      || typeof raw.iat !== "number"
      || typeof raw.exp !== "number"
      || raw.iat > current + 30
      || raw.exp <= current
      || raw.exp - raw.iat > 300
      || typeof raw.jti !== "string"
      || !/^[0-9a-f-]{36}$/i.test(raw.jti)
    ) return null;
    const key = await crypto.subtle.importKey(
      "spki",
      decode(publicKeySpkiBase64),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    if (!await crypto.subtle.verify(
      "Ed25519",
      key,
      decode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )) return null;
    return {
      issuer: "jkamma-identity",
      audience: "jkamma-hub",
      purpose: "selective_credential",
      credentialType: raw.credential_type as HubSelectiveCredential["credentialType"],
      challenge: expectedChallenge,
      jti: raw.jti,
      issuedAt: raw.iat,
      expiresAt: raw.exp,
    };
  } catch {
    return null;
  }
}
