import type { ThreadPost, ThreadReportReason } from "./domain";

export const THREAD_REPORT_REASONS: readonly ThreadReportReason[] = [
  "harassment",
  "spam",
  "privacy",
  "misinformation",
  "other"
];

export function isThreadReportReason(value: unknown): value is ThreadReportReason {
  return typeof value === "string" && THREAD_REPORT_REASONS.some((reason) => reason === value);
}

export function canManageThreadPost(post: Pick<ThreadPost, "authorProfileId">, profileId: string): boolean {
  return post.authorProfileId === profileId;
}
