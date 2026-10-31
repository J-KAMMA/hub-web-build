import type { HubScopedRef } from "@/lib/platform/core-model";

export type HubRankingSurface =
  | "social_feed"
  | "knowledge_feed"
  | "commerce_feed"
  | "media_feed"
  | "community_feed";

export type HubRankSignalBreakdown = {
  base: number;
  relevance: number;
  affinity: number;
  freshness: number;
  trust: number;
  safety: number;
  diversityPenalty: number;
};

export type HubRankCandidate<T> = {
  ref: HubScopedRef;
  value: T;
  baseScore: number;
  relevance?: number;
  affinity?: number;
  freshness?: number;
  trust?: number;
  safety?: number;
  eligible?: boolean;
  stableKey: string;
  tieBreakers?: number[];
  diversityKeys?: Partial<Record<"author" | "source" | "topic", string>>;
};

export type HubRankPolicy = {
  surface: HubRankingSurface;
  weights?: Partial<Record<"relevance" | "affinity" | "freshness" | "trust" | "safety", number>>;
  diversity?: Partial<Record<"author" | "source" | "topic", {
    recentWindow: number;
    penalty: number;
    repeatMultiplier?: number;
    exposureMultiplier?: number;
  }>>;
};

export type HubRankedObject<T> = {
  ref: HubScopedRef;
  value: T;
  score: number;
  breakdown: HubRankSignalBreakdown;
  policy: HubRankingSurface;
  rankerVersion: "hub.graph.ranker.v1";
};

const DEFAULT_WEIGHTS = {
  relevance: 1,
  affinity: 1,
  freshness: 1,
  trust: 1,
  safety: 1,
} as const;

function finite(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

type InternalRanked<T> = HubRankedObject<T> & { candidate: HubRankCandidate<T> };

function compareTieBreakers(left: number[] | undefined, right: number[] | undefined) {
  const length = Math.max(left?.length ?? 0, right?.length ?? 0);
  for (let index = 0; index < length; index += 1) {
    const difference = finite(left?.[index]) - finite(right?.[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

function calculateCandidate<T>(
  candidate: HubRankCandidate<T>,
  ranked: InternalRanked<T>[],
  policy: HubRankPolicy,
): InternalRanked<T> {
  const weights = { ...DEFAULT_WEIGHTS, ...policy.weights };
  const breakdown: HubRankSignalBreakdown = {
    base: finite(candidate.baseScore),
    relevance: finite(candidate.relevance) * weights.relevance,
    affinity: finite(candidate.affinity) * weights.affinity,
    freshness: finite(candidate.freshness) * weights.freshness,
    trust: finite(candidate.trust) * weights.trust,
    safety: finite(candidate.safety) * weights.safety,
    diversityPenalty: 0,
  };
  const scoreBeforeDiversity = breakdown.base
    + breakdown.relevance
    + breakdown.affinity
    + breakdown.freshness
    + breakdown.trust
    + breakdown.safety;
  let diversityMultiplier = 1;
  for (const kind of ["author", "source", "topic"] as const) {
    const key = candidate.diversityKeys?.[kind];
    const rule = policy.diversity?.[kind];
    if (!key || !rule) continue;
    const repetitions = ranked
      .slice(-Math.max(0, rule.recentWindow))
      .filter((entry) => entry.candidate.diversityKeys?.[kind] === key)
      .length;
    breakdown.diversityPenalty += repetitions * Math.max(0, rule.penalty);
    const totalExposures = ranked.filter(
      (entry) => entry.candidate.diversityKeys?.[kind] === key,
    ).length;
    if (
      ranked.at(-1)?.candidate.diversityKeys?.[kind] === key
      && Number.isFinite(rule.repeatMultiplier)
    ) {
      diversityMultiplier *= Math.max(0, Number(rule.repeatMultiplier));
    }
    if (totalExposures > 0 && Number.isFinite(rule.exposureMultiplier)) {
      diversityMultiplier *= Math.pow(
        Math.max(0, Number(rule.exposureMultiplier)),
        totalExposures,
      );
    }
  }
  const score = scoreBeforeDiversity * diversityMultiplier - breakdown.diversityPenalty;
  breakdown.diversityPenalty += scoreBeforeDiversity * (1 - diversityMultiplier);
  return {
    ref: candidate.ref,
    value: candidate.value,
    score,
    breakdown,
    policy: policy.surface,
    rankerVersion: "hub.graph.ranker.v1",
    candidate,
  };
}

/**
 * Common Hub Graph ranking contract.
 *
 * Domain adapters remain responsible for producing privacy-safe aggregate
 * signals. This engine applies the shared eligibility, score explanation,
 * deterministic ordering, and diversity rules without reading service data.
 */
export function rankHubObjects<T>(
  candidates: readonly HubRankCandidate<T>[],
  policy: HubRankPolicy,
): HubRankedObject<T>[] {
  const remaining = candidates
    .filter((candidate) => candidate.eligible !== false)
    .map((candidate, sourceIndex) => ({ candidate, sourceIndex }));
  const ranked: InternalRanked<T>[] = [];

  while (remaining.length) {
    let bestIndex = 0;
    let best: InternalRanked<T> | null = null;
    for (let index = 0; index < remaining.length; index += 1) {
      const calculated = calculateCandidate(remaining[index].candidate, ranked, policy);
      const current = remaining[index];
      const selected = remaining[bestIndex];
      const tieComparison = compareTieBreakers(
        current.candidate.tieBreakers,
        selected.candidate.tieBreakers,
      );
      if (
        !best
        || calculated.score > best.score
        || (
          calculated.score === best.score
          && (
            tieComparison > 0
            || (
              tieComparison === 0
              && (
                current.candidate.stableKey < selected.candidate.stableKey
                || (
                  current.candidate.stableKey === selected.candidate.stableKey
                  && current.sourceIndex < selected.sourceIndex
                )
              )
            )
          )
        )
      ) {
        best = calculated;
        bestIndex = index;
      }
    }
    remaining.splice(bestIndex, 1);
    ranked.push(best!);
  }

  return ranked.map(({ candidate: _candidate, ...entry }) => entry);
}
