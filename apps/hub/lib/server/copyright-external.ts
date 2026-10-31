import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  OBJECTION_WINDOW_DAYS,
  immediateHideAllowed,
  inquiryDeadline,
  isCaseState,
  type CaseState,
} from "@/lib/copyright-case-state";
import {
  postDecisionToRightsDesk,
  signHubToken,
  type DecisionResponse,
  type RightsAction,
} from "@/lib/server/rights-desk-boundary";

/*
 * Music・Vault の対象の運営の判断（PLAN 6.5）。
 *
 * - Hub は Music・Vault を呼ばない。運営の判断は Hub が署名したトークン（iss jkamma-hub → aud jkamma-rights、
 *   purpose rights.<action>）にし、運営のブラウザが Rights Desk の
 *   POST /rights/api/v1/cases/{事件番号}/decisions へ本文なしで直接送る。Rights Desk が署名し直して持ち主へ出す。
 * - トークンは、運営の権限を確かめたあとにだけ Hub が作る（呼び出し側の責任。route が確かめる）。
 * - ブラウザの報告は信じない。反映の確認は、Hub のサーバーが rights.read を Rights Desk に送って行い、
 *   その答えだけを Hub の表（state・締切・時刻）に写す。
 * - 判断を作った時点で pending_action に残す。反映が確かめられたら消す。Rights Desk が止まっている（502・503）
 *   ときは残り、定期処理が新しいトークンでやり直す。
 * - 7日の掃除（Hub の Worker）は rights.hide を、14日の掃除は rights.finalize を送る。
 */

export type ExternalAction = Exclude<RightsAction, "read">;

export class ExternalDecisionError extends Error {
  constructor(
    readonly code: "not_found" | "not_external" | "forbidden_transition" | "invalid_input" | "unconfigured",
    message: string,
  ) {
    super(message);
    this.name = "ExternalDecisionError";
  }
}

type ExternalRow = {
  id: string;
  caseId: string;
  caseNumber: string;
  service: string;
  targetId: string;
  state: CaseState;
  deadline: string | null;
  hiddenAt: string | null;
  objectionOpen: number | bigint;
  pendingAction: ExternalAction | null;
  pendingParams: string | null;
};

const SELECT = `SELECT t.id, t.case_id AS caseId, c.case_number AS caseNumber, t.service, t.target_id AS targetId, t.state,
    t.inquiry_deadline_at AS deadline, t.hidden_at AS hiddenAt, t.objection_open AS objectionOpen,
    t.pending_action AS pendingAction, t.pending_params AS pendingParams
  FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id`;

async function loadExternal(db: D1Database, rowId: string): Promise<ExternalRow | null> {
  const row = await db.prepare(`${SELECT} WHERE t.id = ? LIMIT 1`).bind(rowId).first<ExternalRow>();
  if (!row) return null;
  return isCaseState(row.state) ? row : null;
}

/** 操作ごとに、Hub が持つ状態のうち受け付けるもの。 */
const ALLOWED_FROM: Record<ExternalAction, readonly CaseState[]> = {
  open: ["received"],
  hide: ["inquiry", "objected"],
  object: ["inquiry"],
  restore: ["hidden"],
  finalize: ["hidden"],
  close: ["received", "inquiry", "objected", "hidden"],
};

/** その操作が持ち主に反映された、と見なしてよい状態。 */
const SATISFIED: Record<ExternalAction, readonly CaseState[]> = {
  open: ["inquiry", "objected", "hidden", "final", "restored", "kept"],
  hide: ["hidden", "final", "restored"],
  object: ["objected", "hidden", "kept", "final", "restored"],
  restore: ["restored"],
  finalize: ["final"],
  close: ["kept", "rejected"],
};

export type DecisionInput = {
  action: ExternalAction;
  /** open：照会か即時 */
  route?: "inquiry" | "immediate";
  /**
   * open で inquiry のとき：運営が形式確認で「明らかな侵害」と印を付けるか。付けた対象だけが、7日で rights.hide を自動で送る。
   * 付けなければ、7日後は運営の判断待ちに戻る（Hub の表を動かすだけ）。
   */
  clearlyInfringing?: boolean;
  /** open で immediate のとき：定められた3つの理由のどれか（PLAN 4.2） */
  immediateReason?: unknown;
  /** 判断理由。immediate では必須（5文字以上）。 */
  note?: string;
  /** close：公開のまま / 却下 */
  outcome?: "kept" | "rejected";
  /** open：任意の締切 */
  due?: string;
};

type Params = { route?: string; reason?: string; outcome?: string; due?: string };

function validate(row: ExternalRow, input: DecisionInput): Params {
  if (!ALLOWED_FROM[input.action].includes(row.state)) {
    throw new ExternalDecisionError("forbidden_transition", "この状態では、その操作はできません。");
  }
  const note = (input.note ?? "").trim();
  const params: Params = {};
  if (input.action === "open") {
    if (input.route !== "inquiry" && input.route !== "immediate") throw new ExternalDecisionError("invalid_input", "route が必要です。");
    params.route = input.route;
    if (input.route === "immediate") {
      if (!immediateHideAllowed(input.immediateReason, note)) {
        throw new ExternalDecisionError("invalid_input", "即時の非公開には、定められた理由と判断理由が必要です。");
      }
      params.reason = `${input.immediateReason as string}: ${note}`.slice(0, 500);
    } else if (note) params.reason = note.slice(0, 500);
    if (input.due !== undefined) {
      if (!Number.isFinite(Date.parse(input.due))) throw new ExternalDecisionError("invalid_input", "due が正しくありません。");
      params.due = new Date(Date.parse(input.due)).toISOString();
    }
  } else if (input.action === "close") {
    if (input.outcome !== "kept" && input.outcome !== "rejected") throw new ExternalDecisionError("invalid_input", "outcome が必要です。");
    // 持ち主にまだ事件が無い（received）対象は、形式不備の却下（rejected）だけ。
    if (row.state === "received" && input.outcome !== "rejected") throw new ExternalDecisionError("forbidden_transition", "まだ開いていない対象は却下だけできます。");
    if (row.state !== "received" && input.outcome === "rejected") throw new ExternalDecisionError("forbidden_transition", "開いた対象の却下は公開のまま（kept）で閉じます。");
    params.outcome = input.outcome;
    if (note) params.reason = note.slice(0, 500);
  } else if (note) {
    params.reason = note.slice(0, 500);
  }
  return params;
}

async function tokenFor(row: ExternalRow, action: RightsAction, params: Params): Promise<string> {
  const token = await signHubToken({
    purpose: `rights.${action}`,
    caseId: row.caseNumber,
    target: row.targetId,
    ...(params.route ? { route: params.route as "inquiry" | "immediate" } : {}),
    ...(params.due ? { due: params.due } : {}),
    ...(params.outcome ? { outcome: params.outcome } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
  });
  if (!token) throw new ExternalDecisionError("unconfigured", "Rights Desk への署名鍵が設定されていません。");
  return token;
}

export type MintedDecision = { token: string; caseNumber: string; targetId: string; path: string };

/**
 * 運営の判断を署名する。呼び出し側が運営の権限を確かめたあとにだけ呼ぶ。
 * 判断は pending_action に残し（反映が確かめられるまで）、署名したトークンを返す。ブラウザはこれを
 * path へ POST（本文なし）する。
 */
export async function mintExternalDecision(
  db: D1Database,
  rowId: string,
  input: DecisionInput,
  now = new Date().toISOString(),
): Promise<MintedDecision> {
  const row = await loadExternal(db, rowId);
  if (!row) throw new ExternalDecisionError("not_found", "申告が見つかりません。");
  if (row.service === "hub") throw new ExternalDecisionError("not_external", "Hub の対象は Hub が直接処理します。");
  const params = validate(row, input);
  const token = await tokenFor(row, input.action, params);
  await db.batch([
    db.prepare("UPDATE copyright_case_targets SET pending_action = ?, pending_params = ?, updated_at = ? WHERE id = ?")
      .bind(input.action, JSON.stringify(params), now, row.id),
    // open のたびに印を入れ直す（前の open が取り下げられていても、今回の判断が正）。
    ...(input.action === "open"
      ? [db.prepare("UPDATE copyright_case_targets SET clearly_infringing = ?, needs_decision_at = NULL WHERE id = ?")
          .bind(input.route === "inquiry" && input.clearlyInfringing === true ? 1 : 0, row.id)]
      : []),
    db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, 'moderator', ?, ?, NULL, ?, ?)`)
      .bind(crypto.randomUUID(), row.caseId, row.id, `decision_${input.action}`, row.state, (params.reason ?? params.outcome ?? params.route ?? "").slice(0, 1000), now),
  ]);
  return { token, caseNumber: row.caseNumber, targetId: row.targetId, path: `/rights/api/v1/cases/${encodeURIComponent(row.caseNumber)}/decisions` };
}

// ---------------------------------------------------------------------------
// 反映の確認（rights.read）と、やり直し
// ---------------------------------------------------------------------------

type ServiceCase = NonNullable<NonNullable<DecisionResponse["body"]>["case"]>;

/** Rights Desk の答え（持ち主の事件の状態）を Hub の表に写し、反映が確かめられた判断は pending から外す。 */
async function applyServiceCase(db: D1Database, row: ExternalRow, c: ServiceCase, now: string): Promise<CaseState | null> {
  if (!isCaseState(c.status) || c.status === "received") return null;
  const status = c.status;
  const satisfied = row.pendingAction ? SATISFIED[row.pendingAction].includes(status) : false;
  const params = row.pendingParams ? (JSON.parse(row.pendingParams) as Params) : {};
  const closeMatches = row.pendingAction !== "close" || params.outcome === status;
  const clear = satisfied && closeMatches;
  const closedAt = c.closedAt ?? (["final", "restored", "kept", "rejected"].includes(status) ? now : null);
  const deadline = status === "inquiry" ? (c.inquiryDueAt ?? row.deadline ?? inquiryDeadline(now)) : (c.inquiryDueAt ?? row.deadline);
  await db.batch([
    db.prepare(`UPDATE copyright_case_targets SET state = ?, inquiry_deadline_at = ?,
        hidden_at = COALESCE(?, hidden_at), final_at = COALESCE(?, final_at), restored_at = COALESCE(?, restored_at),
        closed_at = COALESCE(?, closed_at), service_synced_at = ?, updated_at = ?,
        pending_action = CASE WHEN ? = 1 THEN NULL ELSE pending_action END,
        pending_params = CASE WHEN ? = 1 THEN NULL ELSE pending_params END
      WHERE id = ?`)
      .bind(status, deadline, c.hiddenAt ?? null, c.finalAt ?? null, c.restoredAt ?? null, closedAt, now, now, clear ? 1 : 0, clear ? 1 : 0, row.id),
    db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
      SELECT ?, ?, ?, 'rights_desk', 'service_sync', ?, ?, '', ? WHERE ? <> ?`)
      .bind(crypto.randomUUID(), row.caseId, row.id, row.state, status, now, row.state, status),
    db.prepare(`UPDATE copyright_cases SET closed_at = ?, updated_at = ?
      WHERE id = ? AND closed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM copyright_case_targets WHERE case_id = ? AND state NOT IN ('final','restored','kept','rejected'))`)
      .bind(now, now, row.caseId, row.caseId),
  ]);
  return status;
}

export type SyncResult = { ok: boolean; status: number; state: CaseState | null };

/** rights.read を Hub のサーバーが Rights Desk に送り、答えを写す。ブラウザの報告には頼らない。 */
export async function syncExternalTarget(db: D1Database, rowId: string, now = new Date().toISOString()): Promise<SyncResult> {
  const row = await loadExternal(db, rowId);
  if (!row || row.service === "hub") return { ok: false, status: 404, state: null };
  if (row.state === "received" && row.pendingAction !== "open") return { ok: true, status: 200, state: row.state };
  let token: string;
  try {
    token = await tokenFor(row, "read", {});
  } catch {
    return { ok: false, status: 503, state: row.state };
  }
  const response = await postDecisionToRightsDesk(row.caseNumber, token);
  if (response.status === 404 && row.state === "received") return { ok: true, status: 200, state: row.state }; // まだ開いていない
  if (response.status !== 200 || !response.body?.case) return { ok: false, status: response.status, state: row.state };
  const state = await applyServiceCase(db, row, response.body.case, now);
  return { ok: state !== null, status: 200, state };
}

/**
 * pending の判断を、新しいトークンで Rights Desk に送る（定期処理）。
 * 200：答えを写す。409：持ち主の状態を読んで合わせ、まだ満たされなければ判断を取り下げる。
 * 400・404：やり直しても通らないので取り下げる。401・502・503：残して次の回に回す。
 */
async function sendPending(db: D1Database, row: ExternalRow, now: string): Promise<boolean> {
  if (!row.pendingAction) return false;
  const params = row.pendingParams ? (JSON.parse(row.pendingParams) as Params) : {};
  let token: string;
  try {
    token = await tokenFor(row, row.pendingAction, params);
  } catch {
    return false;
  }
  const response = await postDecisionToRightsDesk(row.caseNumber, token);
  if (response.status === 200 && response.body?.case) {
    await applyServiceCase(db, row, response.body.case, now);
    return true;
  }
  const permanent = response.status === 400 || response.status === 404 || response.status === 409;
  if (response.status === 409) await syncExternalTarget(db, row.id, now);
  if (permanent) {
    const fresh = await loadExternal(db, row.id);
    if (fresh?.pendingAction === row.pendingAction) {
      await db.batch([
        db.prepare("UPDATE copyright_case_targets SET pending_action = NULL, pending_params = NULL, updated_at = ? WHERE id = ? AND pending_action = ?")
          .bind(now, row.id, row.pendingAction),
        db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
          VALUES (?, ?, ?, 'rights_desk', 'decision_dropped', ?, NULL, ?, ?)`)
          .bind(crypto.randomUUID(), row.caseId, row.id, row.state, `${row.pendingAction}:${response.status}:${response.body?.error ?? ""}`.slice(0, 200), now),
      ]);
    }
  }
  return false;
}

export type ExternalSweepResult = { retried: number; hidden: number; finalized: number };

/**
 * Music・Vault の対象の定期処理。
 * 1. 反映が確かめられていない判断を、新しいトークンでやり直す。
 * 2. 照会から7日（持ち主の締切が過ぎた）で同意しない旨がなく、運営が「明らかな侵害」と印を付けていれば rights.hide を送る。
 *    印が無いものは送らない（runCopyrightDeadlines が運営の判断待ちに戻す）。運営が改めて hide を署名すれば送る。
 * 3. 非公開から14日で異議がなければ rights.finalize を送る。
 */
export async function runExternalSweep(db: D1Database, now: string, limit = 50): Promise<ExternalSweepResult> {
  const result: ExternalSweepResult = { retried: 0, hidden: 0, finalized: 0 };

  const pending = await db.prepare(`${SELECT} WHERE t.pending_action IS NOT NULL AND t.service <> 'hub' ORDER BY t.updated_at LIMIT ?`)
    .bind(limit).all<ExternalRow>();
  for (const row of pending.results ?? []) {
    if (await sendPending(db, row, now)) result.retried += 1;
  }

  const queue = async (action: "hide" | "finalize", rows: ExternalRow[], reason: string) => {
    let done = 0;
    for (const row of rows) {
      await db.prepare("UPDATE copyright_case_targets SET pending_action = ?, pending_params = ?, updated_at = ? WHERE id = ? AND pending_action IS NULL")
        .bind(action, JSON.stringify({ reason }), now, row.id).run();
      const fresh = await loadExternal(db, row.id);
      if (fresh?.pendingAction === action && (await sendPending(db, fresh, now))) done += 1;
    }
    return done;
  };

  const dueHide = await db.prepare(`${SELECT} WHERE t.state = 'inquiry' AND t.service <> 'hub' AND t.pending_action IS NULL
    AND t.clearly_infringing = 1 AND t.inquiry_deadline_at <= ? ORDER BY t.inquiry_deadline_at LIMIT ?`).bind(now, limit).all<ExternalRow>();
  result.hidden = await queue("hide", dueHide.results ?? [], "No response within 7 days.");

  const cutoff = new Date(Date.parse(now) - OBJECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const dueFinal = await db.prepare(`${SELECT} WHERE t.state = 'hidden' AND t.service <> 'hub' AND t.pending_action IS NULL
    AND t.objection_open = 0 AND t.hidden_at <= ? ORDER BY t.hidden_at LIMIT ?`).bind(cutoff, limit).all<ExternalRow>();
  result.finalized = await queue("finalize", dueFinal.results ?? [], "No objection within 14 days.");
  return result;
}
