/* Hubpedia Web UI の純粋な部品（表示ラベル・入力検証・エラー文）。サーバー依存なし。 */

export type WikiAuthorKind = "ai" | "human" | "hybrid";

export function authorKindLabel(kind: string | null | undefined): string {
  if (kind === "human") return "人が書いた";
  if (kind === "hybrid") return "AIが書き人が確かめた";
  return "AIが書いた";
}

const knowledgeLabels: Record<string, string> = {
  established: "確立",
  "strong-evidence": "有力な証拠あり",
  "partially-unresolved": "一部未解決",
  provisional: "暫定",
  disputed: "争いあり",
  unverified: "未検証",
  refuted: "反証済み",
};
export function knowledgeStatusLabel(status: string | null | undefined): string {
  if (!status) return "未記録";
  return knowledgeLabels[status] ?? status;
}

export function aiRatioLabel(ratio: number | null | undefined): string {
  const value = typeof ratio === "number" && Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;
  return `${Math.round(value * 100)}%`;
}

const hubPaths: Record<string, string> = {
  post: "/v2/posts/",
  thread: "/v2/threads/",
  thread_post: "/v2/threads/",
  research_version: "/v2/research/",
  article: "/v2/articles/",
  video: "/v2/videos/",
  music_work: "/v2/music?work=",
};
const hubKindLabels: Record<string, string> = {
  post: "投稿",
  thread: "スレッド",
  thread_post: "スレッドの書き込み",
  research_version: "研究",
  article: "記事",
  video: "動画",
  music_work: "曲",
};
export function hubItemHref(kind: string, itemId: string): string | null {
  const base = hubPaths[kind];
  return base ? `${base}${encodeURIComponent(itemId)}` : null;
}
export function hubItemKindLabel(kind: string): string {
  return hubKindLabels[kind] ?? kind;
}

const errorByCode: Record<string, string> = {
  login_required: "ログインが必要です。",
  forbidden: "この操作を行う権限がありません。",
  editor_suspended: "編集が一時停止されています。",
  human_editing_disabled: "人による編集は現在受け付けていません。",
  conflict: "記事が更新されています。読み込み直してからやり直してください。",
  rate_limited: "短時間に操作が集中しています。少し待ってからやり直してください。",
  invalid_input: "入力内容を確認してください。",
};
export function apiErrorMessage(code: string | null | undefined, fallback?: string | null): string {
  if (code && errorByCode[code]) return errorByCode[code];
  return fallback || "処理できませんでした。";
}

export type ClaimProposalKind = "add_claim" | "modify_claim" | "add_evidence" | "add_refuting_evidence";
export const claimProposalKindLabels: Record<ClaimProposalKind, string> = {
  modify_claim: "主張を直す",
  add_evidence: "支持する証拠を足す",
  add_refuting_evidence: "反対の証拠を示す",
  add_claim: "主張を足す",
};

export type ClaimProposalDraft = {
  kind: ClaimProposalKind;
  editSummary: string;
  statement: string;
  evidenceUrl: string;
  evidenceQuote: string;
};

/** 入力の検証。通れば null、通らなければ利用者向けの文。 */
export function validateClaimProposal(draft: ClaimProposalDraft, currentStatement?: string): string | null {
  const summary = draft.editSummary.trim();
  if (summary.length < 3) return "編集の理由を3文字以上で書いてください。";
  if (summary.length > 300) return "編集の理由は300文字までです。";
  if (draft.kind === "modify_claim" || draft.kind === "add_claim") {
    if (draft.statement.trim().length < 5) return "直したあとの主張を5文字以上で書いてください。";
    if (draft.kind === "modify_claim" && currentStatement !== undefined && draft.statement.trim() === currentStatement.trim()) return "主張が元と同じです。直したい部分を変えてください。";
    if (draft.statement.length > 2000) return "主張は2000文字までです。";
  }
  if (draft.kind === "add_evidence" || draft.kind === "add_refuting_evidence") {
    let parsed: URL | null = null;
    try {
      parsed = new URL(draft.evidenceUrl.trim());
    } catch {
      parsed = null;
    }
    if (!parsed || !/^https?:$/u.test(parsed.protocol)) return "出典のURLを http:// または https:// から書いてください。";
    if (draft.evidenceQuote.length > 200) return "引用は200文字までです。";
  }
  return null;
}

export function buildClaimProposalBody(draft: ClaimProposalDraft, claimId: string, baseRevisionKey: string) {
  const body: Record<string, unknown> = {
    kind: draft.kind,
    editSummary: draft.editSummary.trim(),
    baseRevisionKey,
    claimId,
  };
  if (draft.kind === "modify_claim" || draft.kind === "add_claim") body.statement = draft.statement.trim();
  if (draft.kind === "add_evidence" || draft.kind === "add_refuting_evidence") {
    body.evidence = { type: "source", url: draft.evidenceUrl.trim(), ...(draft.evidenceQuote.trim() ? { quote: draft.evidenceQuote.trim() } : {}) };
  }
  if (draft.kind === "add_claim") delete body.claimId;
  return body;
}
