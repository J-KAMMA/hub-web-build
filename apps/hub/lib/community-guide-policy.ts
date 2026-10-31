import type {
  CommunityGuideProposalStatus,
  CommunityGuideReview,
} from "@/lib/domain";

export const COMMUNITY_GUIDE_LIMITS = {
  proposalTitle: 120,
  pageTitle: 120,
  body: 30_000,
  summary: 500,
  review: 2_000,
} as const;

export function normalizeGuideProposalInput(input: {
  title: string;
  proposedTitle: string;
  proposedBody: string;
  summary: string;
}) {
  const normalized = {
    title: input.title.trim(),
    proposedTitle: input.proposedTitle.trim(),
    proposedBody: input.proposedBody.trim(),
    summary: input.summary.trim(),
  };
  if (
    !normalized.title ||
    normalized.title.length > COMMUNITY_GUIDE_LIMITS.proposalTitle
  ) {
    throw new Error("提案名は1〜120文字で入力してください。");
  }
  if (
    !normalized.proposedTitle ||
    normalized.proposedTitle.length > COMMUNITY_GUIDE_LIMITS.pageTitle
  ) {
    throw new Error("攻略ページ名は1〜120文字で入力してください。");
  }
  if (
    !normalized.proposedBody ||
    normalized.proposedBody.length > COMMUNITY_GUIDE_LIMITS.body
  ) {
    throw new Error("攻略本文は1〜30,000文字で入力してください。");
  }
  if (
    !normalized.summary ||
    normalized.summary.length > COMMUNITY_GUIDE_LIMITS.summary
  ) {
    throw new Error("変更概要は1〜500文字で入力してください。");
  }
  return normalized;
}

export function normalizeGuideReviewBody(body: string) {
  const normalized = body.trim();
  if (!normalized || normalized.length > COMMUNITY_GUIDE_LIMITS.review) {
    throw new Error("レビューは1〜2,000文字で入力してください。");
  }
  return normalized;
}

export function hasIndependentGuideApproval(
  reviews: readonly Pick<
    CommunityGuideReview,
    "authorProfileId" | "decision" | "createdAt"
  >[],
  proposalAuthorProfileId: string,
) {
  const latestChangeRequestAt = reviews
    .filter((review) => review.decision === "request_changes")
    .reduce(
      (latest, review) =>
        review.createdAt > latest ? review.createdAt : latest,
      "",
    );
  return reviews.some(
    (review) =>
      review.decision === "approve" &&
      review.authorProfileId !== proposalAuthorProfileId &&
      (!latestChangeRequestAt || review.createdAt > latestChangeRequestAt),
  );
}

export function assertGuideMergeAllowed(input: {
  isManager: boolean;
  status: CommunityGuideProposalStatus;
  hasIndependentApproval: boolean;
  baseVersion: number;
  currentVersion: number;
}) {
  if (!input.isManager) {
    throw new Error("攻略ページをマージできるのは管理者だけです。");
  }
  if (input.status !== "open") {
    throw new Error("レビュー中の変更提案だけをマージできます。");
  }
  if (!input.hasIndependentApproval) {
    throw new Error("提案者以外のメンバーによる承認が1件以上必要です。");
  }
  if (input.currentVersion !== input.baseVersion) {
    throw new Error(
      "攻略ページが更新されています。最新版から変更提案を作り直してください。",
    );
  }
}

export function makeCommunityGuideSlug(
  title: string,
  existingSlugs: readonly string[],
) {
  const base =
    title
      .normalize("NFKC")
      .toLocaleLowerCase("und")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "guide";
  const existing = new Set(existingSlugs.map((slug) => slug.toLowerCase()));
  if (!existing.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, 76)}-${suffix}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error("攻略ページのURLを生成できませんでした。");
}
