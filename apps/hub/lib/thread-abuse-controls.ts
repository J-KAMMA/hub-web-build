import type { Profile, ThreadSummary } from "@/lib/domain";

export type ThreadPostAction =
  | "thread_create"
  | "thread_reply"
  | "social_post"
  | "social_follow";

export const NEW_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;
export const AUTO_HIDE_REPORT_THRESHOLD = 3;

export const THREAD_POST_QUOTAS = {
  established: {
    thread_create: { limit: 3, windowMs: 10 * 60 * 1000 },
    thread_reply: { limit: 12, windowMs: 60 * 1000 },
    social_post: { limit: 20, windowMs: 10 * 60 * 1000 },
    social_follow: { limit: 60, windowMs: 10 * 60 * 1000 },
  },
  newAccount: {
    thread_create: { limit: 1, windowMs: 15 * 60 * 1000 },
    thread_reply: { limit: 5, windowMs: 5 * 60 * 1000 },
    social_post: { limit: 5, windowMs: 10 * 60 * 1000 },
    social_follow: { limit: 15, windowMs: 10 * 60 * 1000 },
  },
} as const;

export function isNewHubAccount(profile: Pick<Profile, "joinedAt">, now = new Date()) {
  const joinedAt = Date.parse(profile.joinedAt);
  return !Number.isFinite(joinedAt) || now.getTime() - joinedAt < NEW_ACCOUNT_AGE_MS;
}

export function getThreadPostQuota(profile: Pick<Profile, "joinedAt">, action: ThreadPostAction, now = new Date()) {
  return (isNewHubAccount(profile, now) ? THREAD_POST_QUOTAS.newAccount : THREAD_POST_QUOTAS.established)[action];
}

function normalizedTitle(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("und").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function bigrams(value: string) {
  if (value.length < 2) return new Set(value ? [value] : []);
  return new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
}

export function threadTitleSimilarity(left: string, right: string) {
  const normalizedLeft = normalizedTitle(left);
  const normalizedRight = normalizedTitle(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.length >= 6 && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))) return 0.9;
  const leftPairs = bigrams(normalizedLeft);
  const rightPairs = bigrams(normalizedRight);
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

export function findSimilarThreads<T extends Pick<ThreadSummary, "id" | "title" | "boardKey" | "updatedAt">>(title: string, threads: readonly T[]) {
  return threads
    .map((thread) => ({ ...thread, similarity: threadTitleSimilarity(title, thread.title) }))
    .filter((thread) => thread.similarity >= 0.5)
    .sort((left, right) => right.similarity - left.similarity || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5);
}
