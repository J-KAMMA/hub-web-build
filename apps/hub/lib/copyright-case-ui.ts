/*
 * 著作権の事件の画面で使う、表示用の純粋関数。DB も時計も持たない（時刻は引数で渡す）。
 * 運営の画面（components/copyright-moderation.tsx）と投稿者の画面（components/copyright-case-response.tsx）が共有する。
 * 状態の決まりそのものは lib/copyright-case-state.ts にある。ここは「どのボタンを出すか」と「どう書くか」だけ。
 */
import { IMMEDIATE_REASONS, objectionWindowEnd, type CaseState, type ImmediateReason } from "@/lib/copyright-case-state";

export const STATE_LABEL: Record<CaseState, string> = {
  received: "受付",
  inquiry: "照会中",
  objected: "同意しない旨の回答あり",
  hidden: "非公開",
  final: "確定して削除",
  restored: "元に戻した",
  kept: "公開のまま",
  rejected: "却下",
};

export type StateTone = "neutral" | "warning" | "danger" | "positive";

export function stateTone(state: CaseState): StateTone {
  if (state === "inquiry" || state === "objected") return "warning";
  if (state === "hidden" || state === "final") return "danger";
  if (state === "restored" || state === "kept") return "positive";
  return "neutral";
}

export const ROLE_LABEL: Record<string, string> = {
  claimant: "申告者",
  author: "投稿者",
  moderator: "運営",
  system: "自動処理",
  rights_desk: "Rights Desk",
};

export const ACTION_LABEL: Record<string, string> = {
  received: "申告を受け付けた",
  format_ok: "形式を確認し、投稿者に照会を始めた",
  immediate: "照会を待たず非公開にした",
  reject: "却下した",
  sender_agrees: "投稿者が措置に同意した",
  sender_objects: "投稿者が同意しない旨を回答した",
  deadline_elapsed: "7日が過ぎ、非公開にした",
  needs_decision: "7日が過ぎ、運営の判断待ちに戻した",
  ops_keep: "公開のままにすると判断した",
  ops_hide: "非公開にすると判断した",
  withdraw: "申告者が取り下げた",
  objection_accepted: "異議を認め、元に戻した",
  objection_rejected: "異議を退け、確定した",
  window_elapsed: "14日が過ぎ、確定した",
  post_hide_objection: "投稿者が非公開への異議を出した",
  service_sync: "Rights Desk の状態を写した",
  decision_open: "判断を署名した（照会・開始）",
  decision_hide: "判断を署名した（非公開）",
  decision_object: "判断を署名した（異議）",
  decision_restore: "判断を署名した（元に戻す）",
  decision_finalize: "判断を署名した（確定）",
  decision_close: "判断を署名した（閉じる）",
};

export const IMMEDIATE_REASON_LABEL: Record<ImmediateReason, string> = {
  matches_removed: "確定削除した作品と指紋がほぼ同じ",
  registered_match_confirmed: "登録作品と指紋が一致し、目で確かめた",
  whole_commercial_copy: "市販作品の丸ごとの転載で、引用などに当たる余地がない",
};
export { IMMEDIATE_REASONS };

export const TARGET_KIND_LABEL: Record<string, string> = {
  social_post: "投稿",
  social_image: "投稿の画像",
  article: "記事",
  hubpedia_revision: "Hubpedia の版",
  video_embed: "動画",
  video: "Hub動画",
  music_track: "音楽",
  vault_content: "ファイル",
};

export const QUEUE_FILTERS = [
  { id: "received", label: "受付" },
  { id: "inquiry", label: "照会中" },
  { id: "needs_decision", label: "判断待ち" },
  { id: "objected", label: "異議・同意せず" },
  { id: "hidden", label: "非公開" },
] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number]["id"];
export function isQueueFilter(value: unknown): value is QueueFilter {
  return QUEUE_FILTERS.some((filter) => filter.id === value);
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の「2026年10月17日 14:05」。不正な値は空文字。 */
export function formatJst(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + JST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  if (!withTime) return date;
  return `${date} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 締切までの残り。過ぎていれば「期限を過ぎています」。 */
export function deadlineCountdown(deadline: string | null, now: string): string {
  if (!deadline) return "";
  const left = Date.parse(deadline) - Date.parse(now);
  if (!Number.isFinite(left)) return "";
  if (left <= 0) return "期限を過ぎています";
  const days = Math.floor(left / 86_400_000);
  if (days >= 1) return `あと${days}日`;
  const hours = Math.floor(left / 3_600_000);
  return hours >= 1 ? `あと${hours}時間` : "あと1時間未満";
}

/** 画面に出す期限の一覧。状態に応じて、いま意味のある期限だけを返す。 */
export type DeadlineLine = { label: string; at: string };
export function deadlineLines(input: {
  state: CaseState;
  deadline: string | null;
  hiddenAt: string | null;
  objectionOpen: boolean;
  clearlyInfringing: boolean;
  needsDecisionAt: string | null;
}): DeadlineLine[] {
  const lines: DeadlineLine[] = [];
  if (input.state === "inquiry" && input.deadline) {
    lines.push({
      label: input.needsDecisionAt
        ? "照会の7日（過ぎています。運営の判断待ち）"
        : input.clearlyInfringing
          ? "照会の7日（回答がなければ非公開にします）"
          : "照会の7日（回答がなければ運営が改めて判断します）",
      at: input.deadline,
    });
  }
  if (input.state === "hidden" && input.hiddenAt) {
    lines.push({
      label: input.objectionOpen ? "異議あり（運営の判断待ち。自動では確定しません）" : "異議の受付と確定（14日）",
      at: objectionWindowEnd(input.hiddenAt),
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 運営が出せる操作
// ---------------------------------------------------------------------------

export type ModeratorActionId =
  | "open_inquiry"
  | "hide_immediately"
  | "reject_notice"
  | "hide"
  | "keep"
  | "restore"
  | "finalize";

export type ModeratorAction = {
  id: ModeratorActionId;
  label: string;
  /** 押す前に見せる説明。 */
  help: string;
  tone: "primary" | "danger" | "neutral";
  /** Hub の対象は unified の PATCH、Music・Vault は署名して Rights Desk へ。 */
  hubAction: "accept" | "reject" | "immediate";
  externalAction: "open" | "hide" | "restore" | "finalize" | "close";
  /** 外部で route を付ける open、または close の outcome。 */
  externalRoute?: "inquiry" | "immediate";
  externalOutcome?: "kept" | "rejected";
  /** 形式確認のとき、「明らかな侵害」の印を付けられる。 */
  clearlyCheckbox?: boolean;
  /** 即時の非公開は、3つの理由から1つ選ぶ。 */
  immediateReason?: boolean;
};

export type CaseFacts = {
  service: "hub" | "music" | "vault";
  state: CaseState;
  objectionOpen: boolean;
  needsDecisionAt: string | null;
};

const A = {
  openInquiry: {
    id: "open_inquiry", label: "形式を確認して照会を始める", tone: "primary",
    help: "投稿者に通知し、7日の回答期間を始めます。印を付けた場合だけ、回答がなければ7日後に自動で非公開にします。",
    hubAction: "accept", externalAction: "open", externalRoute: "inquiry", clearlyCheckbox: true,
  },
  hideNow: {
    id: "hide_immediately", label: "直ちに非公開にする", tone: "danger",
    help: "照会を待たずに隠します。定められた3つの理由のどれかと、判断理由が要ります。",
    hubAction: "immediate", externalAction: "open", externalRoute: "immediate", immediateReason: true,
  },
  rejectNotice: {
    id: "reject_notice", label: "形式不備として却下する", tone: "neutral",
    help: "申告を受け付けず、事件を閉じます。対象は公開のままです。",
    hubAction: "reject", externalAction: "close", externalOutcome: "rejected",
  },
  hide: {
    id: "hide", label: "申告を認めて非公開にする", tone: "danger",
    help: "対象を非公開にします。投稿者は14日以内なら異議を出せます。",
    hubAction: "accept", externalAction: "hide",
  },
  keep: {
    id: "keep", label: "申告を退けて公開のままにする", tone: "neutral",
    help: "対象を公開のままにして、事件を閉じます。",
    hubAction: "reject", externalAction: "close", externalOutcome: "kept",
  },
  restore: {
    id: "restore", label: "元に戻す", tone: "primary",
    help: "非公開を解除して、事件を閉じます。",
    hubAction: "reject", externalAction: "restore",
  },
  finalize: {
    id: "finalize", label: "確定して削除する", tone: "danger",
    help: "異議を退け、対象を削除します。元に戻せません。",
    hubAction: "accept", externalAction: "finalize",
  },
} satisfies Record<string, ModeratorAction>;

/**
 * 状態に応じて、いま出せる操作。出せない理由は waiting に書く。
 * Hub の対象は lib/server/copyright-cases.ts の decideCase、Music・Vault は copyright-external の ALLOWED_FROM と同じ範囲。
 */
export function moderatorActions(facts: CaseFacts): { actions: ModeratorAction[]; waiting: string | null } {
  const { state } = facts;
  switch (state) {
    case "received":
      return { actions: [A.openInquiry, A.hideNow, A.rejectNotice], waiting: null };
    case "inquiry":
      if (facts.needsDecisionAt) return { actions: [A.hide, A.keep], waiting: null };
      return { actions: [A.keep], waiting: "投稿者の回答か、7日の経過を待っています。取り下げ扱いで閉じることだけできます。" };
    case "objected":
      return { actions: [A.hide, A.keep], waiting: null };
    case "hidden":
      if (facts.objectionOpen) return { actions: [A.restore, A.finalize], waiting: null };
      return { actions: [A.restore], waiting: "異議が出ていないため、確定は14日の経過を待ちます。" };
    default:
      return { actions: [], waiting: "この申告はすでに終わっています。" };
  }
}

/** 入力の検査。通ればエラー文は null。 */
export function validateModeratorInput(
  action: ModeratorAction,
  input: { note: string; immediateReason: string },
): string | null {
  const note = input.note.trim();
  if (note.length < 5) return "判断理由を5文字以上で書いてください。";
  if (note.length > 1000) return "判断理由は1000字以内にしてください。";
  if (action.immediateReason && !(IMMEDIATE_REASONS as readonly string[]).includes(input.immediateReason)) {
    return "即時に非公開にする理由を選んでください。";
  }
  return null;
}

// ---------------------------------------------------------------------------
// 投稿者の回答
// ---------------------------------------------------------------------------

export const OBJECTION_REASONS = [
  { id: "quotation", label: "引用にあたる" },
  { id: "licensed", label: "許諾を得ている" },
  { id: "own_work", label: "自分の作品である" },
  { id: "other", label: "その他" },
] as const;
export type ObjectionReasonId = (typeof OBJECTION_REASONS)[number]["id"];

export const OBJECTION_MIN = 20;
export const OBJECTION_MAX = 2000;

export function validateObjection(input: { reason: string; text: string; attested: boolean }): string | null {
  if (!OBJECTION_REASONS.some((r) => r.id === input.reason)) return "理由の種類を選んでください。";
  const length = input.text.trim().length;
  if (length < OBJECTION_MIN) return `理由は${OBJECTION_MIN}字以上で書いてください。`;
  if (length > OBJECTION_MAX - 20) return `理由は${OBJECTION_MAX - 20}字以内にしてください。`;
  if (!input.attested) return "確認事項にチェックを入れてください。";
  return null;
}

export function composeObjectionBody(reason: string, text: string): string {
  const label = OBJECTION_REASONS.find((r) => r.id === reason)?.label ?? "その他";
  return `【${label}】${text.trim()}`;
}

export type AuthorStage = "respond" | "object_after_hide" | "waiting" | "closed";

/** 投稿者の頁で、いま出す回答欄。期限の判定は呼び出し側が時計で行って渡す。 */
export function authorStage(input: {
  state: CaseState;
  canRespond: boolean;
  canObject: boolean;
  objectionOpen: boolean;
  responded: boolean;
}): AuthorStage {
  if (input.state === "inquiry" && input.canRespond && !input.responded) return "respond";
  if (input.state === "hidden" && input.canObject && !input.objectionOpen) return "object_after_hide";
  if (input.state === "final" || input.state === "restored" || input.state === "kept" || input.state === "rejected") return "closed";
  return "waiting";
}
