/*
 * 著作権の事件（対象ごと）の状態遷移と期限。純粋関数だけで、DB も時計も持たない。
 * 設計は docs/hub-copyright/PLAN.md の 4 章。
 *
 *   received ─(形式確認)→ inquiry ─(7日, 同意しない旨なし,
 *       │                    「明らかな侵害」の印あり)→ hidden ─(14日, 異議なし)→ final
 *       │                    ├─(投稿者が同意)→ hidden               ├─(異議を認める)→ restored
 *       │                    └─(同意しない)→ objected ─(運営)→ kept / hidden
 *       ├─(明白：対処法 3条2項1号)→ hidden
 *       └─(形式不備)→ rejected
 *
 * 7日が過ぎても「明らかな侵害」の印が無い照会は、自動では隠さない。照会のまま運営の判断待ち（needs_decision）に戻す。
 *
 * 期限の数え方（PLAN 2.1 の「確かめていない点」に合わせる）：
 * - 照会の7日は、照会の通知を作った時刻から数える。締切の瞬間（ちょうど7日後）から期限切れ。
 * - 非公開後の異議の14日は、非公開にした時刻から数える。
 * - 回答の受付は締切より前だけ。締切の瞬間以降の回答は、定期処理がまだ動いていなくても拒む。
 */

export const CASE_STATES = [
  "received",
  "inquiry",
  "objected",
  "hidden",
  "final",
  "restored",
  "kept",
  "rejected",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

/** 終わった状態。ここから先へは動かない（確定後の再審査は新しい事件として扱う）。 */
export const TERMINAL_STATES: readonly CaseState[] = ["final", "restored", "kept", "rejected"];

export const CASE_TRIGGERS = [
  "format_ok", // 運営が形式を確認し、投稿者に照会する
  "immediate", // 明白な場合。照会を待たずに非公開にする（対処法 3条2項1号）
  "reject", // 形式不備・理由なし
  "sender_agrees", // 投稿者が措置に同意した
  "sender_objects", // 投稿者が同意しない旨を申し出た
  "deadline_elapsed", // 照会から7日たち、同意しない旨の申出がなく、「明らかな侵害」の印があった
  "ops_keep", // 運営が公開のままにすると判断した
  "ops_hide", // 運営が非公開にすると判断した（異議のあと、または印なしで7日が過ぎた照会）
  "withdraw", // 申告者が取り下げた
  "objection_accepted", // 非公開後の異議を認めた
  "objection_rejected", // 非公開後の異議を退けた
  "window_elapsed", // 非公開から14日たち、異議がなかった
] as const;
export type CaseTrigger = (typeof CASE_TRIGGERS)[number];

/** 状態 × きっかけ → 次の状態。ここに無い組み合わせはすべて禁止。 */
const TRANSITIONS: Readonly<Record<CaseState, Partial<Record<CaseTrigger, CaseState>>>> = {
  received: { format_ok: "inquiry", immediate: "hidden", reject: "rejected", withdraw: "kept" },
  inquiry: { sender_agrees: "hidden", sender_objects: "objected", deadline_elapsed: "hidden", ops_hide: "hidden", withdraw: "kept" },
  objected: { ops_keep: "kept", ops_hide: "hidden", withdraw: "kept" },
  hidden: { window_elapsed: "final", objection_rejected: "final", objection_accepted: "restored", withdraw: "restored" },
  final: {},
  restored: {},
  kept: {},
  rejected: {},
};

export class CaseTransitionError extends Error {
  readonly code = "copyright_transition_forbidden";
  constructor(readonly from: CaseState, readonly trigger: CaseTrigger) {
    super(`copyright case: ${trigger} is not allowed from ${from}`);
    this.name = "CaseTransitionError";
  }
}

export function isCaseState(value: unknown): value is CaseState {
  return typeof value === "string" && (CASE_STATES as readonly string[]).includes(value);
}

export function isTerminalState(state: CaseState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** きっかけを与えたときの次の状態。禁止なら null（例外にしない版）。 */
export function nextState(from: CaseState, trigger: CaseTrigger): CaseState | null {
  return TRANSITIONS[from][trigger] ?? null;
}

/** きっかけを与えたときの次の状態。禁止なら CaseTransitionError。 */
export function applyTrigger(from: CaseState, trigger: CaseTrigger): CaseState {
  const next = nextState(from, trigger);
  if (!next) throw new CaseTransitionError(from, trigger);
  return next;
}

/** from から to へ動ける道（どれかのきっかけ）があるか。 */
export function canTransition(from: CaseState, to: CaseState): boolean {
  return Object.values(TRANSITIONS[from]).includes(to);
}

/** from から動ける次の状態の一覧（重複なし）。 */
export function allowedNextStates(from: CaseState): CaseState[] {
  return [...new Set(Object.values(TRANSITIONS[from]))];
}

/** from で受け付けるきっかけの一覧。 */
export function allowedTriggers(from: CaseState): CaseTrigger[] {
  return Object.keys(TRANSITIONS[from]) as CaseTrigger[];
}

/** 対象が公開されていない状態か（運営の画面で「非公開」と出す状態）。 */
export function isNonPublicState(state: CaseState): boolean {
  return state === "hidden" || state === "final";
}

/** 事件の全対象が終わっていれば、事件は閉じている。対象が 0 件の事件は閉じていない。 */
export function caseIsClosed(states: readonly CaseState[]): boolean {
  return states.length > 0 && states.every(isTerminalState);
}

// ---------------------------------------------------------------------------
// 期限
// ---------------------------------------------------------------------------

export const INQUIRY_DAYS = 7;
export const OBJECTION_WINDOW_DAYS = 14;
export const REPORTER_ID_RETENTION_YEARS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseInstant(value: string | Date): number {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError("invalid timestamp");
  return ms;
}

/** 照会の締切（ISO 8601, UTC）。通知を作った時刻の7日後ちょうど。 */
export function inquiryDeadline(notifiedAt: string | Date): string {
  return new Date(parseInstant(notifiedAt) + INQUIRY_DAYS * DAY_MS).toISOString();
}

/** 非公開後に異議を受ける期間の終わり。非公開にした時刻の14日後ちょうど。 */
export function objectionWindowEnd(hiddenAt: string | Date): string {
  return new Date(parseInstant(hiddenAt) + OBJECTION_WINDOW_DAYS * DAY_MS).toISOString();
}

/** 締切の瞬間から期限切れ。 */
export function isPast(deadline: string | Date, now: string | Date): boolean {
  return parseInstant(now) >= parseInstant(deadline);
}

/** 締切より前なら、投稿者の回答（同意・同意しない）を受け付ける。 */
export function canRespondToInquiry(state: CaseState, deadline: string | null, now: string | Date): boolean {
  return state === "inquiry" && deadline !== null && !isPast(deadline, now);
}

/** 非公開後の異議は、非公開の間で、14日の期間内だけ受け付ける。 */
export function canObjectAfterHide(state: CaseState, hiddenAt: string | null, now: string | Date): boolean {
  return state === "hidden" && hiddenAt !== null && !isPast(objectionWindowEnd(hiddenAt), now);
}

/** 照会が期限切れか（印の有無は問わない）。 */
export function inquiryExpired(state: CaseState, deadline: string | null, now: string | Date): boolean {
  return state === "inquiry" && deadline !== null && isPast(deadline, now);
}

/** 期限が過ぎ、運営が「明らかな侵害」と印を付けた照会だけ、定期処理が自動で非公開にする。 */
export function inquiryAutoHideDue(
  state: CaseState,
  deadline: string | null,
  clearlyInfringing: boolean,
  now: string | Date,
): boolean {
  return clearlyInfringing && inquiryExpired(state, deadline, now);
}

/** 期限が過ぎたが印が無く、まだ運営の列に戻していない照会か（戻すのは一度だけ）。 */
export function inquiryNeedsDecisionDue(
  state: CaseState,
  deadline: string | null,
  clearlyInfringing: boolean,
  needsDecisionAt: string | null,
  now: string | Date,
): boolean {
  return !clearlyInfringing && needsDecisionAt === null && inquiryExpired(state, deadline, now);
}

/** 非公開から14日たち、異議の申出もなく、確定してよいか。 */
export function objectionWindowExpired(
  state: CaseState,
  hiddenAt: string | null,
  objectionOpen: boolean,
  now: string | Date,
): boolean {
  return state === "hidden" && !objectionOpen && hiddenAt !== null && isPast(objectionWindowEnd(hiddenAt), now);
}

/**
 * 申告者のプロフィールIDを Hub に置いてよい期限。事件が閉じてから3年（暦で数える）。
 * 閉じていない事件には期限が無い（null）。
 */
export function reporterIdRetentionEnd(closedAt: string | Date | null): string | null {
  if (closedAt === null) return null;
  const date = new Date(parseInstant(closedAt));
  date.setUTCFullYear(date.getUTCFullYear() + REPORTER_ID_RETENTION_YEARS);
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// 即時に非公開にしてよい場合（PLAN 4.2）
// ---------------------------------------------------------------------------

export const IMMEDIATE_REASONS = [
  "matches_removed", // 確定削除した作品と指紋がほぼ同じ
  "registered_match_confirmed", // 登録作品と指紋が一致し、運営が目で確かめた
  "whole_commercial_copy", // 市販作品の丸ごとの転載で、引用や批評に当たる余地が無い
] as const;
export type ImmediateReason = (typeof IMMEDIATE_REASONS)[number];

export function isImmediateReason(value: unknown): value is ImmediateReason {
  return typeof value === "string" && (IMMEDIATE_REASONS as readonly string[]).includes(value);
}

/** 即時の非公開は、この3つのどれかの理由と、運営の判断理由（5文字以上）がそろうときだけ。 */
export function immediateHideAllowed(reason: unknown, note: string): reason is ImmediateReason {
  return isImmediateReason(reason) && note.trim().length >= 5;
}
