export const HUB_TRUST_CONTEXTS = [
  "publishing",
  "commerce",
  "work",
  "community",
  "monetization",
] as const;

export type HubTrustContext = (typeof HUB_TRUST_CONTEXTS)[number];
export type HubTrustEvidenceStatus =
  | "verified"
  | "pending"
  | "not_available"
  | "revoked";
export type HubTrustEvidenceDisplayStatus =
  | HubTrustEvidenceStatus
  | "expired";
export type HubTrustEvidenceVisibility = "public" | "purpose_limited";
export type HubTrustEvidenceDerivation =
  | "direct"
  | "source_attested"
  | "explicitly_linked";

export type HubTrustEvidence = {
  context: HubTrustContext;
  sourceService: "hub" | "commerce" | "vault" | "music" | "listings";
  visibility: HubTrustEvidenceVisibility;
  derivation: HubTrustEvidenceDerivation;
  label: string;
  value: string;
  status: HubTrustEvidenceStatus;
  description: string;
  observedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revocationReason?: string;
};

export function createHubTrustEvidence(
  evidence: HubTrustEvidence,
): HubTrustEvidence {
  if (!HUB_TRUST_CONTEXTS.includes(evidence.context)) {
    throw new Error("Unsupported Hub Trust context.");
  }
  if (!["hub", "commerce", "vault", "music", "listings"].includes(evidence.sourceService)) {
    throw new Error("Unsupported Hub Trust source.");
  }
  if (!["public", "purpose_limited"].includes(evidence.visibility)) {
    throw new Error("Private Hub Trust evidence is prohibited.");
  }
  if (!["direct", "source_attested", "explicitly_linked"].includes(evidence.derivation)) {
    throw new Error("Inferred Hub Trust evidence is prohibited.");
  }
  if (!["verified", "pending", "not_available", "revoked"].includes(evidence.status)) {
    throw new Error("Unsupported Hub Trust status.");
  }
  const observedAt = new Date(evidence.observedAt);
  const expiresAt = new Date(evidence.expiresAt);
  const revokedAt = evidence.revokedAt ? new Date(evidence.revokedAt) : undefined;
  if (
    !Number.isFinite(observedAt.getTime())
    || !Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() <= observedAt.getTime()
  ) {
    throw new Error("Invalid Hub Trust evidence lifetime.");
  }
  if (
    evidence.status === "revoked"
    && (
      !revokedAt
      || !Number.isFinite(revokedAt.getTime())
      || revokedAt.getTime() < observedAt.getTime()
    )
  ) {
    throw new Error("Invalid Hub Trust revocation.");
  }
  if (
    evidence.status !== "revoked"
    && (evidence.revokedAt || evidence.revocationReason)
  ) {
    throw new Error("Hub Trust revocation metadata requires revoked status.");
  }
  const clean = (value: string, length: number) =>
    value.replace(/\s+/g, " ").trim().slice(0, length);
  return {
    ...evidence,
    label: clean(evidence.label, 80),
    value: clean(evidence.value, 80),
    description: clean(evidence.description, 240),
    observedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(revokedAt ? { revokedAt: revokedAt.toISOString() } : {}),
    ...(evidence.revocationReason
      ? { revocationReason: clean(evidence.revocationReason, 160) }
      : {}),
  };
}

export function resolveHubTrustEvidenceStatus(
  evidence: HubTrustEvidence,
  now = new Date(),
): HubTrustEvidenceDisplayStatus {
  if (evidence.status === "revoked") {
    return "revoked";
  }
  if (
    evidence.status !== "not_available"
    && new Date(evidence.expiresAt).getTime() <= now.getTime()
  ) {
    return "expired";
  }
  return evidence.status;
}

export function isHubTrustEvidenceFresh(
  evidence: HubTrustEvidence,
  now = new Date(),
): boolean {
  return resolveHubTrustEvidenceStatus(evidence, now) === "verified";
}
