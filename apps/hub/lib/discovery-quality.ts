import { rankDiscoveryItems } from "./discovery-recommendations";
import { scoreHubInterestText } from "./hub-interest-profile";

export type DiscoveryQualityDescriptor = {
  text: string;
  author?: string;
  topic?: string;
};

export type DiscoveryQualityReport = {
  candidateCount: number;
  relevantCount: number;
  topK: number;
  topKRelevantCount: number;
  topKPrecision: number;
  uniqueAuthorsInTopK: number;
  uniqueTopicsInTopK: number;
  maxConsecutiveAuthor: number;
  maxConsecutiveTopic: number;
  explorationSlotCount: number;
};

function maxConsecutive(values: readonly (string | undefined)[]) {
  let current: string | undefined;
  let run = 0;
  let maximum = 0;
  for (const value of values) {
    if (!value) {
      current = undefined;
      run = 0;
      continue;
    }
    if (value === current) run += 1;
    else {
      current = value;
      run = 1;
    }
    maximum = Math.max(maximum, run);
  }
  return maximum;
}

/**
 * Evaluate a public-metadata recommendation fixture without storing or
 * transmitting user data. The report is a regression signal, not a claim
 * about real-user recommendation quality.
 */
export function evaluateDiscoveryRanking<T>(
  items: readonly T[],
  interests: readonly string[],
  describe: (item: T) => DiscoveryQualityDescriptor,
  requestedTopK = 5,
): { ranked: T[]; report: DiscoveryQualityReport } {
  const ranked = rankDiscoveryItems(items, interests, describe);
  const descriptors = ranked.map(describe);
  const scores = descriptors.map((metadata) => scoreHubInterestText(metadata.text, interests));
  const normalizedTopK = Number.isFinite(requestedTopK) ? Math.trunc(requestedTopK) : 0;
  const topK = Math.min(Math.max(0, normalizedTopK), ranked.length);
  const topScores = scores.slice(0, topK);
  const topDescriptors = descriptors.slice(0, topK);
  const topKRelevantCount = topScores.filter((score) => score > 0).length;
  const explorationSlotCount = scores.filter((score, index) => index > 0 && index % 5 === 0 && score <= 0).length;

  return {
    ranked,
    report: {
      candidateCount: items.length,
      relevantCount: scores.filter((score) => score > 0).length,
      topK,
      topKRelevantCount,
      topKPrecision: topK === 0 ? 0 : topKRelevantCount / topK,
      uniqueAuthorsInTopK: new Set(topDescriptors.map(({ author }) => author).filter(Boolean)).size,
      uniqueTopicsInTopK: new Set(topDescriptors.map(({ topic }) => topic).filter(Boolean)).size,
      maxConsecutiveAuthor: maxConsecutive(descriptors.map(({ author }) => author)),
      maxConsecutiveTopic: maxConsecutive(descriptors.map(({ topic }) => topic)),
      explorationSlotCount,
    },
  };
}
