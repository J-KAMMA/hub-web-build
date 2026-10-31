import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { canObjectAfterHide, canRespondToInquiry, isCaseState, type CaseState } from "@/lib/copyright-case-state";
import { isQueueFilter, type QueueFilter } from "@/lib/copyright-case-ui";

/*
 * 著作権の事件を画面に出すための読み取り。書き込みは copyright-cases.ts / copyright-external.ts が行う。
 * 連絡先は Hub に無いので出ない。申告者は表示名だけ。投稿者のプロフィールIDは運営の画面にも出さない。
 */

export type QueueItem = {
  id: string;
  caseId: string;
  caseNumber: string;
  state: CaseState;
  service: "hub" | "music" | "vault";
  targetKind: string;
  targetId: string;
  claimant: string;
  route: "inquiry" | "immediate";
  deadline: string | null;
  needsDecisionAt: string | null;
  objectionOpen: boolean;
  clearlyInfringing: boolean;
  pendingAction: string | null;
  createdAt: string;
};

type QueueRaw = Omit<QueueItem, "objectionOpen" | "clearlyInfringing" | "state"> & {
  state: string;
  objectionOpen: number | bigint;
  clearlyInfringing: number | bigint;
};

const QUEUE_SELECT = `SELECT t.id, t.case_id AS caseId, c.case_number AS caseNumber, t.state, t.service, t.target_kind AS targetKind,
    t.target_id AS targetId, c.claimant_display_name AS claimant, c.route, t.inquiry_deadline_at AS deadline,
    t.needs_decision_at AS needsDecisionAt, t.objection_open AS objectionOpen, t.clearly_infringing AS clearlyInfringing,
    t.pending_action AS pendingAction, t.created_at AS createdAt
  FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id`;

const FILTER_WHERE: Record<QueueFilter, string> = {
  received: "t.state = 'received'",
  inquiry: "t.state = 'inquiry'",
  needs_decision: "t.state = 'inquiry' AND t.needs_decision_at IS NOT NULL",
  objected: "(t.state = 'objected' OR (t.state = 'hidden' AND t.objection_open = 1))",
  hidden: "t.state = 'hidden'",
};

/** 締切の早い順（締切の無いものは受付の古い順で後ろ）。100行まで。 */
export async function listCopyrightQueueItems(db: D1Database, filter: unknown): Promise<QueueItem[]> {
  const key: QueueFilter = isQueueFilter(filter) ? filter : "received";
  const result = await db.prepare(`${QUEUE_SELECT} WHERE ${FILTER_WHERE[key]}
    ORDER BY (t.inquiry_deadline_at IS NULL), t.inquiry_deadline_at ASC, t.created_at ASC LIMIT 100`).all<QueueRaw>();
  return (result.results ?? []).filter((row) => isCaseState(row.state)).map((row) => ({
    ...row,
    state: row.state as CaseState,
    objectionOpen: Number(row.objectionOpen) === 1,
    clearlyInfringing: Number(row.clearlyInfringing) === 1,
  }));
}

export type TimelineEntry = { role: string; action: string; fromState: string | null; toState: string | null; reason: string; createdAt: string };

export type ModeratorCaseView = QueueItem & {
  workDescription: string;
  claimBasis: string;
  immediateReason: string | null;
  source: string;
  hiddenAt: string | null;
  pendingParams: string | null;
  serviceSyncedAt: string | null;
  /** 同じ事件のほかの対象。 */
  siblings: Array<{ id: string; targetKind: string; targetId: string; state: CaseState }>;
  timeline: TimelineEntry[];
  responses: Array<{ kind: string; body: string; createdAt: string }>;
};

type DetailRaw = QueueRaw & {
  workDescription: string; claimBasis: string; immediateReason: string | null; source: string;
  hiddenAt: string | null; pendingParams: string | null; serviceSyncedAt: string | null;
};

export async function loadModeratorCase(db: D1Database, rowId: string): Promise<ModeratorCaseView | null> {
  const row = await db.prepare(`SELECT t.id, t.case_id AS caseId, c.case_number AS caseNumber, t.state, t.service, t.target_kind AS targetKind,
      t.target_id AS targetId, c.claimant_display_name AS claimant, c.route, t.inquiry_deadline_at AS deadline,
      t.needs_decision_at AS needsDecisionAt, t.objection_open AS objectionOpen, t.clearly_infringing AS clearlyInfringing,
      t.pending_action AS pendingAction, t.created_at AS createdAt,
      c.work_description AS workDescription, c.claim_basis AS claimBasis, c.immediate_reason AS immediateReason, c.source,
      t.hidden_at AS hiddenAt, t.pending_params AS pendingParams, t.service_synced_at AS serviceSyncedAt
    FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id WHERE t.id = ? LIMIT 1`).bind(rowId).first<DetailRaw>();
  if (!row || !isCaseState(row.state)) return null;
  const [events, siblings, responses] = await Promise.all([
    db.prepare(`SELECT role, action, from_state AS fromState, to_state AS toState, reason, created_at AS createdAt
      FROM copyright_case_events WHERE case_id = ? AND (target_id = ? OR target_id IS NULL) ORDER BY created_at ASC, rowid ASC LIMIT 200`)
      .bind(row.caseId, row.id).all<TimelineEntry>(),
    db.prepare("SELECT id, target_kind AS targetKind, target_id AS targetId, state FROM copyright_case_targets WHERE case_id = ? AND id <> ? ORDER BY created_at ASC LIMIT 50")
      .bind(row.caseId, row.id).all<{ id: string; targetKind: string; targetId: string; state: string }>(),
    db.prepare("SELECT kind, body, created_at AS createdAt FROM copyright_case_responses WHERE target_id = ? ORDER BY created_at ASC LIMIT 5")
      .bind(row.id).all<{ kind: string; body: string; createdAt: string }>(),
  ]);
  return {
    ...row,
    state: row.state as CaseState,
    objectionOpen: Number(row.objectionOpen) === 1,
    clearlyInfringing: Number(row.clearlyInfringing) === 1,
    siblings: (siblings.results ?? []).filter((s) => isCaseState(s.state)).map((s) => ({ ...s, state: s.state as CaseState })),
    timeline: events.results ?? [],
    responses: responses.results ?? [],
  } as ModeratorCaseView;
}

/** この対象の事件の当事者（投稿者、または申告者）か。当事者は、その事件に運営として操作できない（PLAN 9.3）。 */
export async function isCopyrightParty(db: D1Database, rowId: string, profileId: string | null | undefined): Promise<boolean> {
  if (!profileId) return false;
  const row = await db.prepare(`SELECT t.author_profile_id AS authorId, c.reporter_profile_id AS reporterId
    FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id WHERE t.id = ? LIMIT 1`)
    .bind(rowId).first<{ authorId: string | null; reporterId: string | null }>();
  return Boolean(row && (row.authorId === profileId || row.reporterId === profileId));
}

// ---------------------------------------------------------------------------
// 投稿者の頁
// ---------------------------------------------------------------------------

export type AuthorTargetView = {
  id: string;
  targetKind: string;
  targetId: string;
  state: CaseState;
  deadline: string | null;
  hiddenAt: string | null;
  objectionOpen: boolean;
  clearlyInfringing: boolean;
  needsDecisionAt: string | null;
  canRespond: boolean;
  canObject: boolean;
  responded: boolean;
  timeline: Array<{ role: string; action: string; toState: string | null; createdAt: string }>;
};

export type AuthorCaseView = {
  caseId: string;
  caseNumber: string;
  claimant: string;
  workDescription: string;
  claimBasis: string;
  targets: AuthorTargetView[];
};

type AuthorRaw = {
  id: string; targetKind: string; targetId: string; state: string; deadline: string | null; hiddenAt: string | null;
  objectionOpen: number | bigint; clearlyInfringing: number | bigint; needsDecisionAt: string | null;
  caseNumber: string; claimant: string; workDescription: string; claimBasis: string;
};

/**
 * 投稿者本人にだけ見せる事件。本人の対象が1件も無ければ null（あるかどうかも知らせない）。
 * 申告者の連絡先・ほかの投稿者の対象・運営の判断理由は出さない。
 */
export async function loadAuthorCase(
  db: D1Database,
  caseId: string,
  profileId: string,
  now = new Date().toISOString(),
): Promise<AuthorCaseView | null> {
  if (!profileId) return null;
  const rows = await db.prepare(`SELECT t.id, t.target_kind AS targetKind, t.target_id AS targetId, t.state, t.inquiry_deadline_at AS deadline,
      t.hidden_at AS hiddenAt, t.objection_open AS objectionOpen, t.clearly_infringing AS clearlyInfringing, t.needs_decision_at AS needsDecisionAt,
      c.case_number AS caseNumber, c.claimant_display_name AS claimant, c.work_description AS workDescription, c.claim_basis AS claimBasis
    FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id
    WHERE t.case_id = ? AND t.author_profile_id = ? ORDER BY t.created_at ASC LIMIT 20`).bind(caseId, profileId).all<AuthorRaw>();
  const list = (rows.results ?? []).filter((row) => isCaseState(row.state));
  if (list.length === 0) return null;
  const targets: AuthorTargetView[] = [];
  for (const row of list) {
    const state = row.state as CaseState;
    const [responses, events] = await Promise.all([
      db.prepare("SELECT kind FROM copyright_case_responses WHERE target_id = ? AND author_profile_id = ? LIMIT 5").bind(row.id, profileId).all<{ kind: string }>(),
      db.prepare(`SELECT role, action, to_state AS toState, created_at AS createdAt FROM copyright_case_events
        WHERE target_id = ? AND role <> 'claimant' ORDER BY created_at ASC, rowid ASC LIMIT 50`).bind(row.id).all<{ role: string; action: string; toState: string | null; createdAt: string }>(),
    ]);
    const kinds = new Set((responses.results ?? []).map((r) => r.kind));
    const objectionOpen = Number(row.objectionOpen) === 1;
    targets.push({
      id: row.id,
      targetKind: row.targetKind,
      targetId: row.targetId,
      state,
      deadline: row.deadline,
      hiddenAt: row.hiddenAt,
      objectionOpen,
      clearlyInfringing: Number(row.clearlyInfringing) === 1,
      needsDecisionAt: row.needsDecisionAt,
      canRespond: canRespondToInquiry(state, row.deadline, now),
      canObject: canObjectAfterHide(state, row.hiddenAt, now) && !objectionOpen && !kinds.has("post_hide_objection"),
      responded: kinds.has("agree") || kinds.has("disagree"),
      timeline: events.results ?? [],
    });
  }
  const first = list[0];
  return { caseId, caseNumber: first.caseNumber, claimant: first.claimant, workDescription: first.workDescription, claimBasis: first.claimBasis, targets };
}
