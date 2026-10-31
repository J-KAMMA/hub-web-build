import { scoreHubInterestText } from "@/lib/hub-interest-profile";

export const HUB_IMAGE_HISTORY_KEY = "hub.image-history.v1";

export type ImageRecommendationCandidate = {
  id: string;
  authorProfileId?: string | null;
  displayName: string;
  handle?: string | null;
  body: string;
  createdAt?: string;
  score?: number;
  bookmarked?: boolean;
  images?: Array<{ altText?: string }>;
};

function normalizedText(candidate: ImageRecommendationCandidate) {
  return [candidate.body, candidate.displayName, candidate.handle ?? "", ...(candidate.images ?? []).map((image) => image.altText ?? "")]
    .join(" ").normalize("NFKC").toLocaleLowerCase("ja");
}

function tokens(candidate: ImageRecommendationCandidate) {
  return new Set(normalizedText(candidate).match(/[\p{L}\p{N}]{2,20}/gu) ?? []);
}

function overlap(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const term of left) if (right.has(term)) count += 1;
  return count;
}

export function readHubImageHistory(storage: Pick<Storage, "getItem">) {
  try {
    const parsed = JSON.parse(storage.getItem(HUB_IMAGE_HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}

export function rememberHubImage(storage: Pick<Storage, "getItem" | "setItem">, postId: string) {
  const next = [postId, ...readHubImageHistory(storage).filter((id) => id !== postId)].slice(0, 100);
  try { storage.setItem(HUB_IMAGE_HISTORY_KEY, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
}

export function imageInterestTerms(candidate: ImageRecommendationCandidate) {
  return [...tokens(candidate)].filter((term) => !/^(画像|写真|投稿|です|ます)$/u.test(term)).slice(0, 8);
}

export function rankHubImages<T extends ImageRecommendationCandidate>(candidates: T[], options: {
  interests: readonly string[];
  historyIds: readonly string[];
  queryActive: boolean;
  now?: number;
}) {
  const now = options.now ?? Date.now();
  const seen = new Set(options.historyIds);
  const scored = candidates.map((candidate, index) => {
    const createdAt = Date.parse(candidate.createdAt ?? "");
    const ageDays = Number.isFinite(createdAt) ? Math.max(0, now - createdAt) / 86_400_000 : 365;
    const relevance = options.queryActive ? Math.max(0, 36 - index * 1.25) : 0;
    const interest = scoreHubInterestText(normalizedText(candidate), options.interests) * 2.8;
    const quality = Math.log1p(Math.max(0, candidate.score ?? 0)) * 5;
    const freshness = 12 * 0.5 ** (ageDays / 30);
    const exploration = seen.has(candidate.id) ? -14 : 4;
    return { candidate, base: relevance + interest + quality + freshness + exploration - (candidate.bookmarked ? 3 : 0), terms: tokens(candidate), index };
  });

  const remaining = [...scored];
  const selected: typeof scored = [];
  while (remaining.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const recent = selected.slice(-3);
      const authorPenalty = recent.some((picked) => (picked.candidate.authorProfileId ?? picked.candidate.handle) === (item.candidate.authorProfileId ?? item.candidate.handle)) ? 16 : 0;
      const similarityPenalty = recent.reduce((sum, picked) => sum + Math.min(10, overlap(item.terms, picked.terms) * 1.5), 0);
      const adjusted = item.base - authorPenalty - similarityPenalty - item.index / 10_000;
      if (adjusted > bestScore) { bestScore = adjusted; bestIndex = index; }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected.map((item) => item.candidate);
}
