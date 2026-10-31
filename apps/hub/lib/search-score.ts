/*
 * One score for the "all" view of Hub search (2026-10-30).
 *
 * The earlier "all" view interleaved the kinds round-robin, so the 5th person outranked the best
 * post. Every result now gets a single score in 0..1 and the lists are merged by it:
 *
 *   score = 0.55 * relevance + 0.20 * recency + 0.10 * engagement + 0.15 * following
 *
 *   relevance   bm25 when the row came from an FTS5 match (bm25 is negative; lower is better):
 *               1 - 1 / (1 + |bm25| / 3). Without bm25 (short-term fallback, LIKE kinds): a
 *               match-quality heuristic supplied by the caller, already in 0..1.
 *   recency     0.5 ^ (ageDays / 30), 0 when the row carries no date.
 *   engagement  log1p(likes + 2 * replies + postCount) / log1p(200), capped at 1. Only counts that
 *               are already on the row; no aggregate query runs for it.
 *   following   1 when the viewer follows the author, else 0.
 *
 * Pure: no clock, no I/O. `nowMs` is passed in.
 */

export type SearchScoreInput = {
  /** bm25() of the matched row (negative, lower is better). Omit or pass 0 when unavailable. */
  bm25?: number | null;
  /** Fallback relevance in 0..1 used when there is no bm25. */
  heuristic?: number | null;
  /** Creation / last-activity time as epoch milliseconds. */
  timestampMs?: number | null;
  likes?: number | null;
  replies?: number | null;
  /** Replies to a thread, comments, etc. when `replies` does not apply. */
  postCount?: number | null;
  followedAuthor?: boolean;
  nowMs: number;
};

export const SEARCH_SCORE_WEIGHTS = { relevance: 0.55, recency: 0.2, engagement: 0.1, following: 0.15 } as const;
const HALF_LIFE_DAYS = 30;
const ENGAGEMENT_CEILING = 200;
const DAY_MS = 86_400_000;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const count = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export function bm25Relevance(bm25: number): number {
  return clamp01(1 - 1 / (1 + Math.abs(bm25) / 3));
}

export function recencyScore(timestampMs: number | null | undefined, nowMs: number): number {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs)) return 0;
  const ageDays = Math.max(0, nowMs - timestampMs) / DAY_MS;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

export function engagementScore(input: Pick<SearchScoreInput, "likes" | "replies" | "postCount">): number {
  const raw = count(input.likes) + 2 * count(input.replies) + count(input.postCount);
  return clamp01(Math.log1p(raw) / Math.log1p(ENGAGEMENT_CEILING));
}

export function scoreSearchResult(input: SearchScoreInput): number {
  const hasBm25 = typeof input.bm25 === "number" && Number.isFinite(input.bm25) && input.bm25 !== 0;
  const relevance = hasBm25 ? bm25Relevance(input.bm25 as number) : clamp01(input.heuristic ?? 0);
  const { relevance: wr, recency: wt, engagement: we, following: wf } = SEARCH_SCORE_WEIGHTS;
  return clamp01(
    wr * relevance
      + wt * recencyScore(input.timestampMs, input.nowMs)
      + we * engagementScore(input)
      + wf * (input.followedAuthor ? 1 : 0),
  );
}

/** Parse the timestamp strings stored on rows (ISO text or epoch digits) to epoch ms. */
export function parseRowTimestamp(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : null;
  if (typeof value !== "string" || !value) return null;
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 1e11 ? parsed * 1000 : parsed;
}
