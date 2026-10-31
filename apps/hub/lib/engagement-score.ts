export interface EngagementSignals {
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
  bookmarkCount?: number;
}

function safeCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

export function calculateEngagementScore(signals: EngagementSignals): number {
  return (
    safeCount(signals.replyCount) * 3 +
    safeCount(signals.repostCount) * 5 +
    safeCount(signals.quoteRepostCount) * 6 +
    safeCount(signals.likeCount) +
    safeCount(signals.bookmarkCount) * 4
  );
}
