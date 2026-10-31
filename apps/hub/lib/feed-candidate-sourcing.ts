/*
 * The stage that decides what is even eligible, before anything is scored.
 *
 * The Hub had one of these and it only served the recommended tab, inside
 * buildRecommendedFeed. The popular tab, and the recommended tab whenever the
 * viewer has no follows or history, went straight to rankPopularFeed — a bare
 * engagement sort that never looked at what the viewer had already read, or
 * noticed that a post was the viewer's own. One path was a pipeline and the
 * other was a sort, so the same screen behaved differently depending on which
 * tab you pressed.
 *
 * The shape follows the published For You pipeline, which puts its cheap
 * exclusions (duplicates, age, the viewer's own posts, muted terms, already
 * seen) ahead of scoring rather than folding them into it. Two things there do
 * not apply here: blocked and muted accounts, which the Hub has no concept of,
 * and subscriber-only content, which it does not have either. A third, the
 * viewer`s own posts, was tried and taken back out: For You can drop them
 * because it has half a billion others, while the Hub shows you your own post
 * the moment you make it, which is how you know it worked. Muted terms are
 * already applied in SQL for D1-backed feeds; the client repeats the check
 * because hidden topics are stored per device and never reach the server.
 */

export interface FeedCandidate {
  id: string;
  authorProfileId: string | null;
  createdAt: string;
}

export type FeedCandidateDropReason =
  | "duplicate"
  | "hidden"
  | "hidden-topic"
  | "seen"
  | "stale";

export interface FeedCandidateContext<T extends FeedCandidate = FeedCandidate> {
  seenPostIds?: Iterable<string>;
  hiddenPostIds?: Iterable<string>;
  hiddenTopics?: readonly string[];
  now?: number;
  /*
   * The published pipeline drops anything older than 48 hours. It can afford
   * to: half a billion posts arrive daily. A Hub feed can hold a hundred, so
   * the cap is applied only while enough candidates survive it — see
   * minimumCandidates.
   */
  maxAgeHours?: number;
  minimumCandidates?: number;
  bodyOf?: (candidate: T) => string;
}

export interface FeedCandidateResult<T> {
  candidates: T[];
  dropped: Record<FeedCandidateDropReason, number>;
}

const HOUR_MS = 60 * 60 * 1000;
export const FEED_CANDIDATE_MAX_AGE_HOURS = 48;
export const FEED_CANDIDATE_MINIMUM = 12;

function emptyDropCounts(): Record<FeedCandidateDropReason, number> {
  return { duplicate: 0, hidden: 0, "hidden-topic": 0, seen: 0, stale: 0 };
}

function ageHoursOf(createdAt: string, now: number): number {
  const parsed = Date.parse(createdAt);
  /* An unparseable date is treated as ancient, never as fresh. */
  return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / HOUR_MS) : Number.POSITIVE_INFINITY;
}

/**
 * Applies the pre-scoring filters in cost order and reports what each one
 * removed. The counts are what makes an empty feed explainable: "everything
 * was already seen" and "nothing matched" look identical without them.
 */
export function sourceFeedCandidates<T extends FeedCandidate>(
  posts: readonly T[],
  context: FeedCandidateContext<T> = {},
): FeedCandidateResult<T> {
  const dropped = emptyDropCounts();
  const now = context.now ?? Date.now();
  const seen = new Set(context.seenPostIds ?? []);
  const hidden = new Set(context.hiddenPostIds ?? []);
  const topics = (context.hiddenTopics ?? []).filter((topic) => topic.trim().length > 0);
  const bodyOf = context.bodyOf ?? ((candidate: T) => (candidate as { body?: string }).body ?? "");
  const seenIds = new Set<string>();

  const kept: T[] = [];
  const staleButKept: T[] = [];
  const seenButKept: T[] = [];

  for (const post of posts) {
    if (seenIds.has(post.id)) {
      dropped.duplicate += 1;
      continue;
    }
    seenIds.add(post.id);

    if (hidden.has(post.id)) {
      dropped.hidden += 1;
      continue;
    }
    if (topics.length > 0) {
      const body = bodyOf(post).toLocaleLowerCase("ja");
      if (topics.some((topic) => body.includes(topic.toLocaleLowerCase("ja")))) {
        dropped["hidden-topic"] += 1;
        continue;
      }
    }
    /*
     * Seen and stale are held back rather than discarded. Both are the sort of
     * exclusion that empties a small feed, and an empty feed is worse than a
     * repeat.
     */
    if (seen.has(post.id)) {
      seenButKept.push(post);
      continue;
    }
    const maxAge = context.maxAgeHours ?? FEED_CANDIDATE_MAX_AGE_HOURS;
    if (Number.isFinite(maxAge) && ageHoursOf(post.createdAt, now) > maxAge) {
      staleButKept.push(post);
      continue;
    }
    kept.push(post);
  }

  const minimum = context.minimumCandidates ?? FEED_CANDIDATE_MINIMUM;
  const candidates = [...kept];
  /* Stale comes back before seen: an old post is new to this reader. */
  if (candidates.length < minimum) {
    const needed = minimum - candidates.length;
    candidates.push(...staleButKept.slice(0, needed));
    dropped.stale += Math.max(0, staleButKept.length - needed);
  } else {
    dropped.stale += staleButKept.length;
  }
  if (candidates.length < minimum) {
    const needed = minimum - candidates.length;
    candidates.push(...seenButKept.slice(0, needed));
    dropped.seen += Math.max(0, seenButKept.length - needed);
  } else {
    dropped.seen += seenButKept.length;
  }

  return { candidates, dropped };
}
