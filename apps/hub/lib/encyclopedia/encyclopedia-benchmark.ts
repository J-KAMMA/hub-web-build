export type EncyclopediaReferenceSnapshot = {
  provider: string;
  articleUrl: string;
  revisionKey: string;
  checkedAt: string;
  concepts: readonly string[];
};

export type HubpediaBenchmarkInput = {
  articleSlug: string;
  concepts: readonly string[];
  sourceCount: number;
  primarySourceCount: number;
  evidenceCoverage: number;
  hasUncertaintySection: boolean;
  hasRightsDisclosure: boolean;
  references: readonly EncyclopediaReferenceSnapshot[];
};

export type HubpediaBenchmarkStatus = "not-compared" | "needs-work" | "meets-baseline" | "adds-value";

function normalizedConcepts(values: readonly string[]) {
  return new Set(values.map((value) => value.normalize("NFKC").trim().toLocaleLowerCase()).filter(Boolean));
}

export function assessEncyclopediaBenchmark(input: HubpediaBenchmarkInput) {
  if (input.references.length === 0) {
    return { status: "not-compared" as const, coverageRatio: 0, missingConcepts: [] as string[], comparedProviders: [] as string[], checkedAt: null };
  }
  const referenceConcepts = normalizedConcepts(input.references.flatMap((reference) => reference.concepts));
  const articleConcepts = normalizedConcepts(input.concepts);
  const missingConcepts = [...referenceConcepts].filter((concept) => !articleConcepts.has(concept));
  const coverageRatio = referenceConcepts.size === 0 ? 1 : (referenceConcepts.size - missingConcepts.length) / referenceConcepts.size;
  const evidenceReady = input.sourceCount >= 2 && input.primarySourceCount >= 1 && input.evidenceCoverage >= 0.7;
  const baselineReady = coverageRatio >= 0.95 && evidenceReady && input.hasRightsDisclosure;
  const addsValue = baselineReady && input.references.length >= 2 && input.evidenceCoverage >= 0.85 && input.hasUncertaintySection;
  return {
    status: addsValue ? "adds-value" as const : baselineReady ? "meets-baseline" as const : "needs-work" as const,
    coverageRatio: Number(coverageRatio.toFixed(2)),
    missingConcepts,
    comparedProviders: [...new Set(input.references.map((reference) => reference.provider))],
    checkedAt: input.references.map((reference) => reference.checkedAt).sort().at(-1) ?? null,
  };
}
