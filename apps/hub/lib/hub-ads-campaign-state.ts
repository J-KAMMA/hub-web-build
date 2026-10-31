export type HubAdCampaignStateInput = {
  status: string;
  reviewStatus: string;
  fundedJpyMicros?: number;
  totalBudgetJpyMicros?: number;
  endAt?: number;
};

export function describeHubAdCampaignState(input: HubAdCampaignStateInput, now = Date.now()) {
  if (input.status === "active") return { key: "delivering", label: "配信中", nextAction: "成果と予算消化を確認" };
  if (input.status === "paused") return { key: "paused", label: "一時停止", nextAction: "内容を確認して配信を再開" };
  if (input.status === "ended" || (input.endAt ?? Infinity) <= now) return { key: "ended", label: "終了", nextAction: "レポートを確認" };
  if (input.reviewStatus === "needs_changes") return { key: "needs_changes", label: "修正が必要", nextAction: "審査理由を直して再提出" };
  if (input.reviewStatus === "rejected") return { key: "rejected", label: "掲載不可", nextAction: "理由を確認し、必要なら再審査を申請" };
  if (input.reviewStatus !== "approved") return { key: "review", label: "審査中", nextAction: "審査完了を待つ" };
  if ((input.fundedJpyMicros ?? 0) < (input.totalBudgetJpyMicros ?? 0)) return { key: "funding", label: "入金待ち", nextAction: "x402で広告費を入金" };
  return { key: "ready", label: "配信準備完了", nextAction: "配信を開始" };
}
