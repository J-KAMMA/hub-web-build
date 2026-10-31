/*
 * Self-made video safety vocabulary (PLAN 5.1, 5.3). Pure and shared by the report UI, the report
 * API and the operator screen. Sexual self-made videos are prohibited (owner rule, 2026-10-15), so
 * they are a report reason of their own and sort ahead of ordinary reports.
 */
export const VIDEO_REPORT_REASONS = [
  { code: "child_sexual", label: "子どもの性的な内容", immediate: true, rank: 0 },
  { code: "sexual_content", label: "性的な内容（自作動画では禁止）", immediate: false, rank: 1 },
  { code: "violence_selfharm", label: "暴力・自傷", immediate: false, rank: 2 },
  { code: "copyright", label: "著作権", immediate: false, rank: 3 },
  { code: "impersonation", label: "なりすまし", immediate: false, rank: 4 },
  { code: "spam", label: "スパム", immediate: false, rank: 5 },
  { code: "other", label: "その他", immediate: false, rank: 6 },
] as const;

export type VideoReportReasonCode = (typeof VIDEO_REPORT_REASONS)[number]["code"];

export function isVideoReportReasonCode(value: unknown): value is VideoReportReasonCode {
  return typeof value === "string" && VIDEO_REPORT_REASONS.some((reason) => reason.code === value);
}

export function videoReportReasonLabel(code: string | null | undefined): string {
  return VIDEO_REPORT_REASONS.find((reason) => reason.code === code)?.label ?? "不適切な動画";
}

/** Videos from a creator who has fewer than this many approved (or already live) ones wait for review. */
export const VIDEO_REVIEW_TRUST_THRESHOLD = 3;
