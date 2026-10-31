export interface SocialTrendCandidate {
  authorProfileId: string | null;
  createdAt: string;
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
}

const HOUR_MS = 60 * 60 * 1000;

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateSocialTrendScore(item: SocialTrendCandidate, now = Date.now()): number {
  const createdAt = new Date(item.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return 0;

  const ageHours = Math.max(0, (now - createdAt) / HOUR_MS);
  const replies = safeCount(item.replyCount);
  const reposts = safeCount(item.repostCount);
  const quotes = safeCount(item.quoteRepostCount);
  const likes = safeCount(item.likeCount);
  const weightedEngagement = replies * 4 + quotes * 5 + reposts * 3 + likes * 1.25;
  const conversationQuality = Math.log1p(replies) * 0.9 + Math.log1p(quotes) * 0.75;
  const discoveryBonus = 0.3 * Math.exp(-ageHours / 4);
  const freshnessDecay = Math.pow(1 + ageHours / 14, 1.35);
  return (Math.log1p(weightedEngagement) + conversationQuality + discoveryBonus) / freshnessDecay;
}

export function rankSocialTrends<T extends SocialTrendCandidate>(items: readonly T[], now = Date.now()): T[] {
  const remaining = items
    .map((item, index) => ({ item, index, rank: calculateSocialTrendScore(item, now) }))
    .sort((left, right) => right.rank - left.rank || right.item.createdAt.localeCompare(left.item.createdAt) || left.index - right.index);
  const ranked: T[] = [];
  const authorAppearances = new Map<string, number>();

  while (remaining.length) {
    const previousAuthor = ranked.at(-1)?.authorProfileId;
    let selectedIndex = 0;
    let selectedScore = Number.NEGATIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const author = candidate.item.authorProfileId;
      const appearances = author ? (authorAppearances.get(author) ?? 0) : 0;
      const adjacentPenalty = author && author === previousAuthor ? 0.3 : 1;
      const exposurePenalty = author ? Math.pow(0.68, appearances) : 1;
      const adjusted = candidate.rank * adjacentPenalty * exposurePenalty;
      if (adjusted > selectedScore) {
        selectedIndex = index;
        selectedScore = adjusted;
      }
    });
    const selected = remaining.splice(selectedIndex, 1)[0].item;
    ranked.push(selected);
    if (selected.authorProfileId) authorAppearances.set(selected.authorProfileId, (authorAppearances.get(selected.authorProfileId) ?? 0) + 1);
  }

  return ranked;
}
