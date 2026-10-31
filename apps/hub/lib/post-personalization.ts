import type { TimelinePost } from "@/components/timeline-client";
import { sortNewestFeed } from "@/lib/feed-ranking";

export const POST_HISTORY_KEY = "hub.post_history";
export const HIDDEN_POSTS_KEY = "hub.feed.hidden-posts";
export const HIDDEN_TOPICS_KEY = "hub.feed.hidden-topics";
export const FEED_PREFERENCES_EVENT = "hub:feed-preferences-changed";

function readStringList(storage: Pick<Storage, "getItem">, key: string, limit = 100): string[] {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, limit) : [];
  } catch { return []; }
}

export function readHiddenPostIds(storage: Pick<Storage, "getItem">): string[] {
  return readStringList(storage, HIDDEN_POSTS_KEY);
}

export function readHiddenTopics(storage: Pick<Storage, "getItem">): string[] {
  return readStringList(storage, HIDDEN_TOPICS_KEY, 30);
}

export function hideFeedItem(storage: Pick<Storage, "getItem" | "setItem">, postId: string, topic?: string | null): void {
  storage.setItem(HIDDEN_POSTS_KEY, JSON.stringify([postId, ...readHiddenPostIds(storage).filter((id) => id !== postId)].slice(0, 100)));
  if (topic) storage.setItem(HIDDEN_TOPICS_KEY, JSON.stringify([topic, ...readHiddenTopics(storage).filter((item) => item !== topic)].slice(0, 30)));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FEED_PREFERENCES_EVENT));
}

export function primaryPostTopic(body: string): string | null {
  const ignored = new Set(["これ", "それ", "ため", "こと", "です", "ます", "して", "から", "with", "that", "this", "have"]);
  return (body.toLocaleLowerCase("ja").match(/[\p{L}\p{N}]{3,20}/gu) ?? []).find((token) => !ignored.has(token)) ?? null;
}

export function recommendationReason(post: TimelinePost, followedProfileIds: Set<string>, historyIds: string[]): "follow" | "interest" | "popular" | "new" {
  if (post.authorProfileId && followedProfileIds.has(post.authorProfileId)) return "follow";
  const history = new Set(historyIds);
  if (post.viewerReaction === "like" || post.bookmarked || history.has(post.id)) return "interest";
  if (post.score + post.likeCount * 2 + post.replyCount * 3 >= 10) return "popular";
  return "new";
}

export function readPostHistory(storage: Pick<Storage, "getItem">): string[] {
  try {
    const value = JSON.parse(storage.getItem(POST_HISTORY_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
  } catch { return []; }
}

export function rememberPost(storage: Pick<Storage, "getItem" | "setItem">, postId: string): void {
  const next = [postId, ...readPostHistory(storage).filter((id) => id !== postId)].slice(0, 100);
  try { storage.setItem(POST_HISTORY_KEY, JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
}

export type RecommendationCandidate = {
  post: TimelinePost;
  source: "following" | "discovery";
  rank: number;
  interestOverlap: number;
};

const RECOMMENDED_FOLLOWING_SHARE = 0.4;
const RECOMMENDATION_HOUR_MS = 60 * 60 * 1000;

function postTokens(body: string): string[] {
  return body.toLocaleLowerCase("ja").match(/[\p{L}\p{N}]{2,24}/gu) ?? [];
}

function recommendationInterestTokens(posts: readonly TimelinePost[], history: Set<string>): Set<string> {
  return new Set(posts
    .filter((post) => post.viewerReaction === "like" || post.bookmarked || history.has(post.id))
    .flatMap((post) => postTokens(post.body)));
}

/**
 * Scores each candidate independently. Candidate isolation keeps an item's
 * score stable regardless of which other candidates happen to be in a batch.
 */
export function scoreRecommendationCandidate(
  post: TimelinePost,
  context: {
    followedProfileIds: Set<string>;
    historyIds: Set<string>;
    interestTokens: Set<string>;
    now: number;
  },
): RecommendationCandidate {
  const followed = Boolean(post.authorProfileId && context.followedProfileIds.has(post.authorProfileId));
  const interestOverlap = postTokens(post.body).filter((token) => context.interestTokens.has(token)).length;
  const createdAt = Date.parse(post.createdAt);
  const ageHours = Number.isFinite(createdAt)
    ? Math.max(0, (context.now - createdAt) / RECOMMENDATION_HOUR_MS)
    : 24 * 365;
  const freshness = 8 / Math.pow(1 + ageHours / 18, 1.25);

  // Separate action signals keep one cheap action (likes) from dominating
  // replies, quotes, reposts, or saves.
  const actionValue =
    Math.log1p(Math.max(0, post.replyCount)) * 4 +
    Math.log1p(Math.max(0, post.quoteRepostCount)) * 5 +
    Math.log1p(Math.max(0, post.repostCount)) * 3 +
    Math.log1p(Math.max(0, post.likeCount)) * 1.25 +
    Math.log1p(Math.max(0, post.score)) * 1.5;
  const explicitInterest = (post.viewerReaction === "like" ? 5 : 0) + (post.bookmarked ? 7 : 0);
  const seenPenalty = context.historyIds.has(post.id) ? 18 : 0;

  return {
    post,
    source: followed ? "following" : "discovery",
    rank: freshness + actionValue + explicitInterest + interestOverlap * 2.5 + (followed ? 9 : 0) - seenPenalty,
    interestOverlap,
  };
}

export function buildRecommendedFeed(
  posts: TimelinePost[],
  followedProfileIds: Set<string>,
  historyIds: string[],
  now = Date.now(),
): TimelinePost[] {
  if (posts.length < 2) return sortNewestFeed(posts);
  const history = new Set(historyIds);
  const interestTokens = recommendationInterestTokens(posts, history);
  const unseen = posts.filter((post) => !history.has(post.id));
  const candidatePosts = unseen.length > 0 ? unseen : posts;
  const remaining = candidatePosts
    .map((post) => scoreRecommendationCandidate(post, { followedProfileIds, historyIds: history, interestTokens, now }))
    .sort((left, right) => right.rank - left.rank || right.post.createdAt.localeCompare(left.post.createdAt));

  // With no useful behavioral or graph signal, chronology is safer and more
  // predictable than pretending to personalize.
  const hasPersonalSignal = followedProfileIds.size > 0 || interestTokens.size > 0;
  if (!hasPersonalSignal) return sortNewestFeed(candidatePosts);

  const result: TimelinePost[] = [];
  const authorAppearances = new Map<string, number>();
  let followingSelected = 0;
  while (remaining.length > 0) {
    const nextLength = result.length + 1;
    const followingNeeded = Math.ceil(nextLength * RECOMMENDED_FOLLOWING_SHARE) > followingSelected;
    const hasFollowingCandidate = remaining.some((candidate) => candidate.source === "following");
    const requireFollowing = followingNeeded && hasFollowingCandidate;
    let selectedIndex = 0;
    let selectedRank = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      if (requireFollowing && candidate.source !== "following") return;
      const author = candidate.post.authorProfileId;
      const appearances = author ? (authorAppearances.get(author) ?? 0) : 0;
      const previousAuthor = result.at(-1)?.authorProfileId;
      const diversityPenalty = author && author === previousAuthor ? 7 : appearances * 3;
      const sourceAdjustment = candidate.source === "following" ? 1 : 0;
      const adjustedRank = candidate.rank + sourceAdjustment - diversityPenalty;
      if (adjustedRank > selectedRank) {
        selectedIndex = index;
        selectedRank = adjustedRank;
      }
    });

    const [selected] = remaining.splice(selectedIndex, 1);
    result.push(selected.post);
    if (selected.source === "following") followingSelected += 1;
    if (selected.post.authorProfileId) {
      authorAppearances.set(selected.post.authorProfileId, (authorAppearances.get(selected.post.authorProfileId) ?? 0) + 1);
    }
  }
  return result;
}

export function personalizePosts(posts: TimelinePost[], followedProfileIds: Set<string>, historyIds: string[]): TimelinePost[] {
  return buildRecommendedFeed(posts, followedProfileIds, historyIds);
}

export function recommendedInterest(posts: TimelinePost[], historyIds: string[]): string | null {
  const history = new Set(historyIds);
  const counts = new Map<string, number>();
  for (const post of posts.filter((item) => item.viewerReaction === "like" || item.bookmarked || history.has(item.id))) {
    for (const token of post.body.match(/[\p{L}\p{N}]{2,20}/gu) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
