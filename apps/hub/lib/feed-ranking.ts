import { rankHubObjects } from "@/lib/platform/hub-object-ranking";
import {
  hubRankPolicyForPreference,
  type HubRankingPreference,
} from "@/lib/hub-ranking-preference";

export interface FeedRankable {
  id?: string;
  authorProfileId: string | null;
  createdAt: string;
  score: number;
}

const HOUR_MS = 60 * 60 * 1000;

/*
 * Signals the viewer has given about this post or its author. The published
 * For You ranker carries these as weights on predicted probabilities — not
 * interested, mute, block, report, not dwelled — and lets the score sink the
 * post rather than removing it; dropping is left to visibility filtering.
 * The Hub only ever removed. A post the reader scrolled past and a post they
 * asked never to see again were the same thing to it: still there, or gone.
 */
export interface FeedRankSignals {
  /* The reader asked for less of this, without hiding the post outright. */
  notInterested?: boolean;
  /* Shown and passed over. Weak on its own, and it accumulates. */
  skipped?: number;
  reported?: boolean;
  /* The author is not followed. In-network is the default expectation. */
  outOfNetwork?: boolean;
  /* An author with almost no audience yet, lifted toward being seen at all. */
  newAuthor?: boolean;
}

/*
 * Multipliers, not subtractions. A penalty in points swamps a small score and
 * leaves a large one standing; a multiplier moves both by the same proportion,
 * which is what makes the ordering between two posts mean the same thing at
 * any level of engagement.
 */
export const FEED_SIGNAL_WEIGHTS = {
  notInterested: 0.25,
  reported: 0.15,
  skip: 0.82,
  outOfNetwork: 0.85,
  newAuthor: 1.25,
} as const;

const MAX_SKIP_DECAY = 4;

/*
 * Who counts as a writer nobody has found yet.
 *
 * A plain threshold does not survive a small network: with four accounts and
 * a handful of follows, everyone is below any floor worth naming, and a boost
 * everyone receives is not a boost — it multiplies the whole feed by 1.25 and
 * changes no ordering at all. So the audience is read against the batch: the
 * lift applies only where somebody present actually has a larger audience to
 * be smaller than.
 */
export const NEW_AUTHOR_FOLLOWER_CEILING = 2;

export function newAuthorProfileIds(
  posts: readonly { authorProfileId: string | null; authorFollowerCount?: number }[],
  ceiling = NEW_AUTHOR_FOLLOWER_CEILING,
): Set<string> {
  const audiences = new Map<string, number>();
  for (const post of posts) {
    if (!post.authorProfileId || post.authorFollowerCount === undefined) continue;
    audiences.set(post.authorProfileId, Math.max(0, post.authorFollowerCount));
  }
  const established = [...audiences.values()].some((count) => count > ceiling);
  if (!established) return new Set();
  return new Set(
    [...audiences].filter(([, count]) => count <= ceiling).map(([profileId]) => profileId),
  );
}

export function applyFeedRankSignals(score: number, signals: FeedRankSignals = {}): number {
  let adjusted = score;
  if (signals.notInterested) adjusted *= FEED_SIGNAL_WEIGHTS.notInterested;
  if (signals.reported) adjusted *= FEED_SIGNAL_WEIGHTS.reported;
  if (signals.outOfNetwork) adjusted *= FEED_SIGNAL_WEIGHTS.outOfNetwork;
  if (signals.newAuthor) adjusted *= FEED_SIGNAL_WEIGHTS.newAuthor;
  const skips = Math.min(MAX_SKIP_DECAY, Math.max(0, Math.floor(signals.skipped ?? 0)));
  if (skips > 0) adjusted *= Math.pow(FEED_SIGNAL_WEIGHTS.skip, skips);
  return adjusted;
}

export function calculateFeedRankScore(
  item: FeedRankable,
  now = Date.now(),
  signals: FeedRankSignals = {},
): number {
  const createdAt = new Date(item.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return 0;

  const ageHours = Math.max(0, (now - createdAt) / HOUR_MS);
  const engagement = Math.log1p(Math.max(0, Number.isFinite(item.score) ? item.score : 0));
  const discoveryBonus = 0.35 * Math.exp(-ageHours / 6);
  const freshnessDecay = Math.pow(1 + ageHours / 18, 1.3);
  return applyFeedRankSignals((engagement + discoveryBonus) / freshnessDecay, signals);
}

export function sortNewestFeed<T extends Pick<FeedRankable, "createdAt">>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/*
 * The popular tab used to be the one path that knew nothing about the reader:
 * no signals, no network, the same order for everyone. signalsFor is how the
 * caller hands it what it was missing.
 */
export function rankPopularFeed<T extends FeedRankable>(
  items: readonly T[],
  now = Date.now(),
  preference: HubRankingPreference = "balanced",
  signalsFor: (item: T) => FeedRankSignals = () => ({}),
): T[] {
  return rankHubObjects(
    items.map((item, index) => ({
      ref: {
        namespace: "hub",
        kind: "post",
        id: item.id ?? `feed-${index}`,
      },
      value: item,
      baseScore: calculateFeedRankScore(item, now, signalsFor(item)),
      stableKey: `${item.createdAt}:${item.id ?? String(index).padStart(8, "0")}`,
      tieBreakers: [Date.parse(item.createdAt), -index],
      diversityKeys: item.authorProfileId ? { author: item.authorProfileId } : undefined,
    })),
    {
      ...hubRankPolicyForPreference("social_feed", preference),
      diversity: {
        author: {
          recentWindow: 1,
          penalty: 0,
          repeatMultiplier: 0.35,
          exposureMultiplier: 0.72,
        },
      },
    },
  ).map((entry) => entry.value);
}
