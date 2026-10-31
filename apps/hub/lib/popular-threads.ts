interface PopularThreadCandidate {
  postCount: number;
  updatedAt: string;
  recentPostCount?: number;
  recentParticipantCount?: number;
}

const HOUR_MS = 60 * 60 * 1000;

function safeCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

export function calculateThreadRankScore(
  thread: PopularThreadCandidate,
  now = Date.now()
): number {
  const updatedAt = new Date(thread.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return 0;

  const ageHours = Math.max(0, (now - updatedAt) / HOUR_MS);
  const lifetimePosts = safeCount(thread.postCount);
  const recentPosts = safeCount(thread.recentPostCount);
  const recentParticipants = safeCount(thread.recentParticipantCount);
  const recentShare = lifetimePosts > 0 ? Math.min(1, recentPosts / lifetimePosts) : 0;
  const participantBreadth = recentPosts > 0 ? Math.min(1, recentParticipants / recentPosts) : 0;
  const activity =
    1 +
    Math.log1p(lifetimePosts) * 1.5 +
    Math.log1p(recentPosts) * 5 +
    Math.log1p(recentParticipants) * 6 +
    recentShare * 2 +
    participantBreadth * 2;
  return activity / Math.pow(1 + ageHours / 36, 1.3);
}

export function rankPopularThreads<T extends PopularThreadCandidate>(
  threads: readonly T[],
  limit = 10,
  now = Date.now()
): T[] {
  return [...threads]
    .sort((left, right) =>
      calculateThreadRankScore(right, now) - calculateThreadRankScore(left, now) ||
      right.updatedAt.localeCompare(left.updatedAt)
    )
    .slice(0, limit);
}
