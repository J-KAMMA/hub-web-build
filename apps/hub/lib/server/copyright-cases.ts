import "server-only";

import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";

import {
  CaseTransitionError,
  applyTrigger,
  canObjectAfterHide,
  canRespondToInquiry,
  immediateHideAllowed,
  inquiryDeadline,
  isCaseState,
  objectionWindowEnd,
  reporterIdRetentionEnd,
  type CaseState,
  type CaseTrigger,
  type ImmediateReason,
  CASE_STATES,
  INQUIRY_DAYS,
  OBJECTION_WINDOW_DAYS,
  REPORTER_ID_RETENTION_YEARS,
} from "@/lib/copyright-case-state";
import { unpublishAttachedFiles } from "@/lib/server/content-files";
import type { HubVideoDeps } from "@/lib/server/hub-videos";
import { runExternalSweep } from "@/lib/server/copyright-external";
import {
  collectScrubObjectKeys,
  deleteScrubObjects,
  hideStatements,
  isCopyrightTargetKind,
  parseRestoreData,
  resolveCopyrightTarget,
  restoreStatements,
  scrubStatements,
  serializeRestoreData,
  type CopyrightTargetKind,
  type StatementTarget,
} from "@/lib/server/copyright-visibility";
import {
  parseTargetUrl,
  reportOutcomeToRightsDesk,
  type RightsDeskClaims,
  type RightsDeskOpenBody,
  type RightsOutcome,
  type RightsService,
} from "@/lib/server/rights-desk-boundary";

/*
 * 著作権の事件の Hub 側の処理（PLAN 4 章・6.1）。
 *
 * - 事件の番号と申告者の表示名だけを持つ。連絡先は Rights Desk にあり、ここには入らない。
 * - 状態の更新は、比較して入れ替える（CAS）1 本の batch で行う。同じ batch に、公開状態の書き込み・
 *   追記だけの記録・通知を、「この更新が勝ったときだけ」効く形で入れる。
 * - 本文は記録にも通知にも写さない。
 */

export type CopyrightCaseErrorCode =
  | "invalid_input"
  | "target_not_found"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "deadline_passed"
  | "rate_limited"
  | "duplicate"
  | "forbidden_transition"
  | "rejected_intake";

export class CopyrightCaseError extends Error {
  constructor(readonly code: CopyrightCaseErrorCode, message: string) {
    super(message);
    this.name = "CopyrightCaseError";
  }
}

type Role = "claimant" | "author" | "moderator" | "system" | "rights_desk";

export type CopyrightTargetRow = {
  id: string;
  caseId: string;
  /** Music・Vault の対象は music_track / vault_content。Hub の表では隠さない。 */
  kind: CopyrightTargetKind | "music_track" | "vault_content";
  service: RightsService;
  targetId: string;
  authorId: string | null;
  state: CaseState;
  deadline: string | null;
  hiddenAt: string | null;
  objectionOpen: boolean;
  /** 運営が形式確認で付けた「明らかな侵害」の印。1 のときだけ、7日で自動的に非公開にする。 */
  clearlyInfringing: boolean;
  /** 印が無いまま7日が過ぎ、運営の判断待ちに戻した時刻。 */
  needsDecisionAt: string | null;
  restoreData: string | null;
  caseNumber: string;
  claimant: string;
  route: "inquiry" | "immediate";
  immediateReason: ImmediateReason | null;
  reporterId: string | null;
  source: string;
};

const TARGET_SELECT = `SELECT t.id, t.case_id AS caseId, t.target_kind AS kind, t.service, t.target_id AS targetId,
    t.author_profile_id AS authorId, t.state, t.inquiry_deadline_at AS deadline, t.hidden_at AS hiddenAt,
    t.objection_open AS objectionOpen, t.clearly_infringing AS clearlyInfringing, t.needs_decision_at AS needsDecisionAt,
    t.restore_data AS restoreData,
    c.case_number AS caseNumber, c.claimant_display_name AS claimant, c.route, c.immediate_reason AS immediateReason,
    c.reporter_profile_id AS reporterId, c.source
  FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id`;

type RawTarget = Omit<CopyrightTargetRow, "objectionOpen" | "clearlyInfringing"> & {
  objectionOpen: number | bigint;
  clearlyInfringing: number | bigint;
};

export async function loadCopyrightTarget(db: D1Database, rowId: string): Promise<CopyrightTargetRow | null> {
  const row = await db.prepare(`${TARGET_SELECT} WHERE t.id = ? LIMIT 1`).bind(rowId).first<RawTarget>();
  if (!row || !isCaseState(row.state) || !(isCopyrightTargetKind(row.kind) || row.kind === "music_track" || row.kind === "vault_content")) return null;
  return { ...row, objectionOpen: Number(row.objectionOpen) === 1, clearlyInfringing: Number(row.clearlyInfringing) === 1 };
}

async function requireTarget(db: D1Database, rowId: string): Promise<CopyrightTargetRow> {
  const row = await loadCopyrightTarget(db, rowId);
  if (!row) throw new CopyrightCaseError("not_found", "申告が見つかりません。");
  return row;
}

// ---------------------------------------------------------------------------
// 共通の動かし方
// ---------------------------------------------------------------------------

const TERMINAL_SQL = "('final','restored','kept','rejected')";

type Cond = { sql: string; args: unknown[] };

type Move = {
  trigger: CaseTrigger;
  role: Role;
  reason?: string;
  now: string;
  /** 勝ったときだけ効く追加の文。 */
  extra?: (won: Cond) => D1PreparedStatement[];
  /** 比較して入れ替える文に足す条件（例：期限の前だけ）。 */
  where?: { sql: string; args: unknown[] };
  /** 条件を満たすときだけ事件の route を immediate にする。 */
  immediateReason?: ImmediateReason;
  /** 照会を始めるとき（to が inquiry）に、運営が「明らかな侵害」と印を付けるか。 */
  clearlyInfringing?: boolean;
  media?: R2Bucket;
  /** 自作動画を動画の Worker に伝える先。省略すると実行環境から組み立てる。 */
  videoDeps?: HubVideoDeps;
};

function describeStateForAuthor(to: CaseState, row: CopyrightTargetRow, now: string, clearly: boolean): string | null {
  switch (to) {
    case "inquiry":
      return `「${row.claimant}」から著作権の申出があり、あなたの投稿について照会しています。内容を確認し、${inquiryDeadline(now).slice(0, 10)}までに措置へ同意するか、同意しない旨を回答してください。${clearly ? "回答がない場合は非公開にします。" : "回答がない場合は、運営が改めて判断します。"}`;
    case "hidden":
      return `著作権の申出により、投稿を非公開にしました。${objectionWindowEnd(now).slice(0, 10)}までは異議を申し出られます。`;
    case "restored":
      return "著作権の申出への判断が変わり、非公開を解除しました。";
    case "final":
      return "著作権の申出により、非公開にした投稿を確定して削除しました。";
    case "kept":
      return "著作権の申出を確認し、投稿は公開のままにしました。";
    case "objected":
      return "同意しない旨の回答を受け付けました。運営が双方の言い分を見て判断します。";
    default:
      return null;
  }
}

function describeStateForReporter(to: CaseState): string | null {
  switch (to) {
    case "inquiry":
      return "著作権の申告を確認し、投稿者に照会を始めました。";
    case "hidden":
      return "著作権の申告を受け、対象を非公開にしました。";
    case "final":
      return "著作権の申告に基づき、対象の削除を確定しました。";
    case "restored":
      return "著作権の申告への判断を見直し、対象を元に戻しました。";
    case "kept":
      return "著作権の申告を確認し、対象は公開のままにしました。裁判所への申立てや発信者情報開示の請求は、権利者ご自身の手続として利用できます。";
    case "rejected":
      return "著作権の申告を確認しましたが、現時点では対応対象とは判断しませんでした。";
    default:
      return null;
  }
}

function fileTargetType(kind: CopyrightTargetRow["kind"]): "post" | "article" | null {
  if (kind === "social_post") return "post";
  if (kind === "article") return "article";
  return null;
}

async function move(db: D1Database, row: CopyrightTargetRow, m: Move): Promise<CaseState> {
  if (row.service !== "hub" || row.kind === "music_track" || row.kind === "vault_content") {
    // Music・Vault の対象は、運営が署名した判断を Rights Desk 経由で持ち主に出す（copyright-external）。Hub の表は動かさない。
    throw new CopyrightCaseError("forbidden_transition", "Music・Vault の対象は、判断の署名を通して Rights Desk へ送ります。");
  }
  let to: CaseState;
  try {
    to = applyTrigger(row.state, m.trigger);
  } catch (error) {
    if (error instanceof CaseTransitionError) {
      throw new CopyrightCaseError("forbidden_transition", "この状態では、その操作はできません。");
    }
    throw error;
  }
  const { now } = m;
  const sets = ["state = ?", "updated_at = ?"];
  const setArgs: unknown[] = [to, now];
  let restoreData: string | null = row.restoreData;
  let resolved: Awaited<ReturnType<typeof resolveCopyrightTarget>> = null;
  if (to === "inquiry") {
    sets.push("inquiry_notified_at = ?", "inquiry_deadline_at = ?", "clearly_infringing = ?", "needs_decision_at = NULL");
    setArgs.push(now, inquiryDeadline(now), m.clearlyInfringing ? 1 : 0);
  } else if (to === "hidden") {
    resolved = await resolveCopyrightTarget(db, row.kind, row.targetId);
    restoreData = serializeRestoreData(resolved?.restore ?? null);
    sets.push("hidden_at = ?", "restore_data = ?", "objection_open = 0");
    setArgs.push(now, restoreData);
  } else if (to === "final") {
    sets.push("final_at = ?", "closed_at = ?");
    setArgs.push(now, now);
  } else if (to === "restored") {
    sets.push("restored_at = ?", "closed_at = ?", "objection_open = 0");
    setArgs.push(now, now);
  } else if (to === "kept" || to === "rejected") {
    sets.push("closed_at = ?");
    setArgs.push(now);
  }

  const won: Cond = {
    sql: "EXISTS (SELECT 1 FROM copyright_case_targets WHERE id = ? AND state = ? AND updated_at = ?)",
    args: [row.id, to, now],
  };
  const stmtTarget: StatementTarget = {
    rowId: row.id,
    kind: row.kind,
    id: row.targetId,
    caseNumber: row.caseNumber,
    restore: to === "hidden" ? (resolved?.restore ?? null) : parseRestoreData(restoreData),
  };

  let scrubKeys: string[] = [];
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE copyright_case_targets SET ${sets.join(", ")} WHERE id = ? AND state = ?${m.where ? ` AND ${m.where.sql}` : ""}`)
      .bind(...setArgs, row.id, row.state, ...(m.where?.args ?? [])),
  ];
  if (to === "hidden") statements.push(...hideStatements(db, stmtTarget, now));
  if (to === "restored") statements.push(...restoreStatements(db, stmtTarget, now));
  if (to === "final") {
    scrubKeys = await collectScrubObjectKeys(db, row.kind, row.targetId);
    statements.push(...scrubStatements(db, stmtTarget, now));
  }
  if (m.immediateReason) {
    statements.push(db.prepare(`UPDATE copyright_cases SET route = 'immediate', immediate_reason = ?, updated_at = ?
      WHERE id = ? AND ${won.sql}`).bind(m.immediateReason, now, row.caseId, ...won.args));
  }
  if (m.extra) statements.push(...m.extra(won));

  statements.push(db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${won.sql}`)
    .bind(crypto.randomUUID(), row.caseId, row.id, m.role, m.trigger, row.state, to, (m.reason ?? "").slice(0, 1000), now, ...won.args));

  const notices: Array<[string, string, string]> = [];
  const authorText = describeStateForAuthor(to, row, now, to === "inquiry" ? m.clearlyInfringing === true : row.clearlyInfringing);
  if (row.authorId && authorText) notices.push([row.authorId, authorText, `/v2/copyright/cases/${row.caseId}`]);
  const reporterText = describeStateForReporter(to);
  if (row.reporterId && reporterText) notices.push([row.reporterId, reporterText, "/notifications"]);
  for (const [receiver, text, route] of notices) {
    statements.push(db.prepare(`INSERT INTO notifications
      (id, receiver_profile_id, actor_profile_id, notification_type, target_type, target_id, text, is_read, created_at)
      SELECT ?, ?, NULL, 'system', 'system', ?, ?, 0, ? WHERE ${won.sql}`)
      .bind(crypto.randomUUID(), receiver, `${route}#event=copyright-case:${row.id}:${to}`, text.slice(0, 1000), now, ...won.args));
  }

  // 閉じた対象で、事件の全対象が終わったら事件を閉じる（申告者IDの3年はここから数える）。
  statements.push(db.prepare(`UPDATE copyright_cases SET closed_at = ?, updated_at = ?
    WHERE id = ? AND closed_at IS NULL AND ${won.sql}
      AND NOT EXISTS (SELECT 1 FROM copyright_case_targets WHERE case_id = ? AND state NOT IN ${TERMINAL_SQL})`)
    .bind(now, now, row.caseId, ...won.args, row.caseId));

  const results = await db.batch(statements);
  const changes = Number((results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
  if (changes !== 1) throw new CopyrightCaseError("conflict", "他の処理が先に状態を変更しました。もう一度確認してください。");

  if (to === "final") await deleteScrubObjects(m.media, scrubKeys);
  // 投稿・記事を隠したら、付いているゲート付きファイルの配信も止める（即時の非公開も、7日の自動も、ここを通る）。
  // unpublishAttachedFiles は投げず、届かなかった分は再試行に回る。
  // 既知の欠け：復元（restored）はファイルを再公開しない。復元後に必要なら、作者が付け直す。
  if (to === "hidden") {
    const target = fileTargetType(row.kind);
    if (target) await unpublishAttachedFiles(db, { targetType: target, targetId: row.targetId });
    // 自作動画：一覧に載っている行（external_videos）が隠れたら、その動画も非公開にする（同じ型）。
    // 動画の Worker へ届かなかった分は hub_video_outbox から再試行される。
    if (row.kind === "video_embed") {
      const { unpublishHubVideosForCatalogEntry } = await import("@/lib/server/hub-videos");
      const { hubVideoDepsFromEnv } = await import("@/lib/server/hub-videos-env");
      await unpublishHubVideosForCatalogEntry(db, m.videoDeps ?? hubVideoDepsFromEnv(), row.targetId);
    }
  }
  // 自作動画（video）：非公開は停止、復元は停止解除、確定は削除（阻止つき）を動画の Worker に伝える。
  // 仕事は上の batch で hub_video_outbox に積んである。ここは今すぐ送ってみるだけで、届かなければ定期処理が再送する。
  if (row.kind === "video" && (to === "hidden" || to === "restored" || to === "final")) {
    const { drainHubVideoCopyrightOutbox } = await import("@/lib/server/hub-videos");
    const { hubVideoDepsFromEnv } = await import("@/lib/server/hub-videos-env");
    await drainHubVideoCopyrightOutbox(db, m.videoDeps ?? hubVideoDepsFromEnv(), row.targetId);
  }
  // Rights Desk への結果の通知は、失敗しても事件の進行を止めない。
  if (row.source === "rights_desk") {
    try {
      await reportTargetOutcome(row.caseNumber, row.targetId, to, m.trigger);
    } catch {
      /* best effort */
    }
  }
  return to;
}

// ---------------------------------------------------------------------------
// 受付
// ---------------------------------------------------------------------------

const LEGACY_TARGET_TYPES: Record<string, CopyrightTargetKind> = {
  social_post: "social_post",
  social_image: "social_image",
  video: "video_embed",
  hubpedia: "hubpedia_revision",
  article: "article",
  hubpedia_revision: "hubpedia_revision",
  video_embed: "video_embed",
};

export function normalizeTargetKind(value: unknown): CopyrightTargetKind | null {
  return typeof value === "string" ? (LEGACY_TARGET_TYPES[value] ?? null) : null;
}

function generateCaseNumber(now: string): string {
  return `HUB-${now.slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

const REPORTER_DAILY_LIMIT = 10;
const MAX_TARGETS_PER_CASE = 20;

export type CreatedCase = { caseId: string; caseNumber: string; targetRowIds: string[] };

/**
 * Hub にログインした人の申告（経路 hub-login）。表示名はプロフィールの表示名。
 * 連絡先は取らない。プロフィールIDは事件が閉じてから3年で消える。
 */
export async function createHubUserCase(
  db: D1Database,
  input: {
    reporter: { id: string; displayName: string };
    targetType: unknown;
    targetId: unknown;
    workDescription: unknown;
    claimBasis: unknown;
  },
  now = new Date().toISOString(),
): Promise<CreatedCase> {
  const kind = normalizeTargetKind(input.targetType);
  const targetId = typeof input.targetId === "string" ? input.targetId.trim() : "";
  const work = typeof input.workDescription === "string" ? input.workDescription.trim() : "";
  const basis = typeof input.claimBasis === "string" ? input.claimBasis.trim() : "";
  if (!kind || !targetId || targetId.length > 200 || work.length < 20 || work.length > 2000 || basis.length < 20 || basis.length > 2000) {
    throw new CopyrightCaseError("invalid_input", "入力を確認してください。");
  }
  const since = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM
    (SELECT 1 FROM copyright_cases WHERE reporter_profile_id = ? AND created_at >= ? LIMIT ${REPORTER_DAILY_LIMIT})`)
    .bind(input.reporter.id, since).first<{ n: number | bigint }>();
  if (Number(recent?.n ?? 0) >= REPORTER_DAILY_LIMIT) {
    throw new CopyrightCaseError("rate_limited", "短い間に申告が続いています。時間をおいてください。");
  }
  const resolved = await resolveCopyrightTarget(db, kind, targetId);
  if (!resolved) throw new CopyrightCaseError("target_not_found", "対象が見つかりません。");
  const open = await db.prepare(`SELECT 1 AS found FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id
    WHERE t.target_kind = ? AND t.target_id = ? AND c.reporter_profile_id = ? AND t.state NOT IN ${TERMINAL_SQL} LIMIT 1`)
    .bind(resolved.kind, resolved.id, input.reporter.id).first();
  if (open) throw new CopyrightCaseError("duplicate", "この対象への申告はすでに受け付けています。");

  const caseId = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const caseNumber = generateCaseNumber(now);
  const name = input.reporter.displayName.trim().slice(0, 120) || "Hub利用者";
  await db.batch([
    db.prepare(`INSERT INTO copyright_cases (id, case_number, source, claimant_display_name, work_description, claim_basis, route,
      reporter_profile_id, created_at, updated_at) VALUES (?, ?, 'hub_user', ?, ?, ?, 'inquiry', ?, ?, ?)`)
      .bind(caseId, caseNumber, name, work, basis, input.reporter.id, now, now),
    db.prepare(`INSERT INTO copyright_case_targets (id, case_id, target_kind, target_id, author_profile_id, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'received', ?, ?)`).bind(rowId, caseId, resolved.kind, resolved.id, resolved.authorProfileId, now, now),
    db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
      VALUES (?, ?, ?, 'claimant', 'received', NULL, 'received', '', ?)`).bind(crypto.randomUUID(), caseId, rowId, now),
  ]);
  return { caseId, caseNumber, targetRowIds: [rowId] };
}

function stringIn(value: unknown, min: number, max: number): string | null {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
}

export type RightsDeskResult = { status: number; body: Record<string, unknown> };

const PROBE_ORDER: CopyrightTargetKind[] = ["social_post", "article", "social_image", "video", "video_embed", "hubpedia_revision"];
const SERVICES = ["hub", "music", "vault"] as const;

/** 種類の手掛かり（targetUrl の形）があればそれを、無ければ ID から順に探す。見つからなければ null。 */
async function resolveHubTarget(db: D1Database, id: string, url: string) {
  const parsed = parseTargetUrl(url);
  const hinted = parsed && parsed.id === id ? normalizeTargetKind(parsed.kind) : null;
  for (const kind of hinted ? [hinted] : PROBE_ORDER) {
    const resolved = await resolveCopyrightTarget(db, kind, id);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Rights Desk の rights.open（対象 1 件につき 1 要求）：事件の対象にする。事件（case）は最初の要求で作り、
 * 同じ事件の次の対象は同じ事件に足す。case と target が同じ要求の再送は何も作らず、200 で既存の状態を返す。
 *
 * - 権限はトークンの claims（case・target）だけで決まる。本文の caseId / targetId がトークンと違えば拒む。
 * - route / due は受け取らない。照会か即時かは運営が決める（理由つき）。
 * - service が music / vault の対象は、審査の列にだけ置く。Hub の表では隠さず、Hub は Music・Vault を呼ばない。
 * - Hub の対象で実在しないものは、事件の記録にだけ残して 200 で返す（Rights Desk は再送するため）。
 */
export async function handleRightsDeskIntake(
  db: D1Database,
  claims: Pick<RightsDeskClaims, "caseId" | "target">,
  rawBody: string,
  now = new Date().toISOString(),
): Promise<RightsDeskResult> {
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return { status: 400, body: { error: "invalid_input" } }; }
  const p = body as Partial<RightsDeskOpenBody> | null;
  const claimant = stringIn(p?.claimantDisplayName, 1, 120);
  const work = stringIn(p?.workDescription, 1, 2000);
  const basis = stringIn(p?.claimBasis, 1, 2000);
  const url = stringIn(p?.targetUrl, 1, 2000);
  const service = (SERVICES as readonly unknown[]).includes(p?.service) ? (p?.service as RightsService) : null;
  if (!p || p.v !== 1 || p.caseId !== claims.caseId || p.targetId !== claims.target || !claimant || !work || !basis || !url || !service) {
    return { status: 400, body: { error: "invalid_input" } };
  }
  const found = async () => db.prepare("SELECT id FROM copyright_cases WHERE case_number = ? LIMIT 1").bind(claims.caseId).first<{ id: string }>();
  let caseRow = await found();
  if (!caseRow) {
    await db.prepare(`INSERT OR IGNORE INTO copyright_cases (id, case_number, source, claimant_display_name, work_description, claim_basis, route,
      reporter_profile_id, created_at, updated_at) VALUES (?, ?, 'rights_desk', ?, ?, ?, 'inquiry', NULL, ?, ?)`)
      .bind(crypto.randomUUID(), claims.caseId, claimant, work, basis, now, now).run();
    caseRow = await found();
  }
  if (!caseRow) return { status: 503, body: { error: "unavailable" } };

  let kind: CopyrightTargetKind | "music_track" | "vault_content";
  let targetId: string = claims.target;
  let authorId: string | null = null;
  if (service === "hub") {
    const resolved = await resolveHubTarget(db, claims.target, url);
    if (!resolved) {
      const reason = `target=${claims.target}`.slice(0, 200);
      await db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
        SELECT ?, ?, NULL, 'rights_desk', 'target_not_found', NULL, NULL, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM copyright_case_events WHERE case_id = ? AND action = 'target_not_found' AND reason = ?)`)
        .bind(crypto.randomUUID(), caseRow.id, reason, now, caseRow.id, reason).run();
      return { status: 200, body: { caseId: claims.caseId, targetId: claims.target, service, state: "rejected", reason: "target_not_found" } };
    }
    kind = resolved.kind;
    targetId = resolved.id;
    authorId = resolved.authorProfileId;
  } else {
    kind = service === "music" ? "music_track" : "vault_content";
  }

  const existing = await db.prepare("SELECT id, state FROM copyright_case_targets WHERE case_id = ? AND target_kind = ? AND target_id = ? LIMIT 1")
    .bind(caseRow.id, kind, targetId).first<{ id: string; state: string }>();
  if (existing) return { status: 200, body: { caseId: claims.caseId, targetId: claims.target, service, state: existing.state, replayed: true } };

  const rowId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO copyright_case_targets (id, case_id, service, target_kind, target_id, author_profile_id, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)`).bind(rowId, caseRow.id, service, kind, targetId, authorId, now, now),
    db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
      SELECT ?, ?, ?, 'rights_desk', 'received', NULL, 'received', '', ? WHERE EXISTS (SELECT 1 FROM copyright_case_targets WHERE id = ?)`)
      .bind(crypto.randomUUID(), caseRow.id, rowId, now, rowId),
  ]);
  return { status: 201, body: { caseId: claims.caseId, targetId: claims.target, service, state: "received" } };
}

/** Hub の対象が終わりの状態になったら、Hub の結果を Rights Desk に知らせる（Hub の対象だけ。Music・Vault の対象は Rights Desk が閉じる）。 */
async function reportTargetOutcome(caseNumber: string, targetId: string, to: CaseState, trigger: CaseTrigger): Promise<void> {
  const outcome: RightsOutcome | null = to === "final" || to === "restored" || to === "kept" || to === "rejected"
    ? (trigger === "withdraw" ? "withdrawn" : to)
    : null;
  if (outcome) await reportOutcomeToRightsDesk(caseNumber, targetId, outcome);
}

// ---------------------------------------------------------------------------
// 運営の操作
// ---------------------------------------------------------------------------

export type OpsOptions = {
  immediateReason?: unknown;
  /** 形式確認で「明らかな侵害」と印を付ける。付けた照会だけが、7日で自動的に非公開になる。 */
  clearlyInfringing?: boolean;
  media?: R2Bucket;
  videoDeps?: HubVideoDeps;
  now?: string;
};

const CLEARLY_INFRINGING_LABEL = "明らかな侵害";

function withClearlyLabel(note: string, clearly: boolean): string {
  return clearly ? `${CLEARLY_INFRINGING_LABEL}: ${note}` : note;
}

/**
 * 形式を確認し、投稿者に照会を始める（received → inquiry）。
 * clearlyInfringing を付けた対象だけが、7日の経過で自動的に非公開になる。付けなければ、7日後に運営の判断待ちへ戻る。
 */
export async function openInquiry(db: D1Database, rowId: string, note: string, o: OpsOptions = {}): Promise<CaseState> {
  const row = await requireTarget(db, rowId);
  const clearly = o.clearlyInfringing === true;
  return move(db, row, {
    trigger: "format_ok", role: "moderator", reason: withClearlyLabel(note, clearly), now: o.now ?? new Date().toISOString(),
    clearlyInfringing: clearly, media: o.media, videoDeps: o.videoDeps,
  });
}

/** 明白な場合に照会を待たず非公開にする（received → hidden）。3つの理由と判断理由が要る。 */
export async function hideImmediately(db: D1Database, rowId: string, reason: unknown, note: string, o: OpsOptions = {}): Promise<CaseState> {
  if (!immediateHideAllowed(reason, note)) {
    throw new CopyrightCaseError("invalid_input", "即時の非公開には、定められた理由と判断理由が必要です。");
  }
  const row = await requireTarget(db, rowId);
  return move(db, row, {
    trigger: "immediate", role: "moderator", reason: `${reason}: ${note}`, now: o.now ?? new Date().toISOString(),
    immediateReason: reason, media: o.media, videoDeps: o.videoDeps,
  });
}

/**
 * 運営の判断。申告を認める（accept）か退ける（reject）かで、状態ごとに動きが決まる。
 *
 * | 状態               | accept（申告を認める）              | reject（申告を退ける）        |
 * | received           | 事件の route に従う（照会 / 即時）    | rejected                     |
 * | objected           | hidden（非公開にする）               | kept（公開のまま）           |
 * | hidden（異議あり） | final（確定して削除）                | restored（元に戻す）         |
 * | hidden（異議なし） | 不可（14日の経過か異議の判断を待つ） | restored（元に戻す）         |
 * | inquiry            | 7日が過ぎて印が無く判断待ちなら hidden。それ以外は不可（投稿者の回答か7日を待つ） | kept（取り下げ扱いで閉じる） |
 */
export async function decideCase(
  db: D1Database,
  rowId: string,
  decision: "accept" | "reject",
  note: string,
  o: OpsOptions = {},
): Promise<CaseState> {
  const row = await requireTarget(db, rowId);
  const now = o.now ?? new Date().toISOString();
  const base = { role: "moderator" as const, reason: note, now, media: o.media, videoDeps: o.videoDeps };
  switch (row.state) {
    case "received":
      if (decision === "reject") return move(db, row, { ...base, trigger: "reject" });
      if (row.route === "immediate" && row.immediateReason) return move(db, row, { ...base, trigger: "immediate" });
      return move(db, row, {
        ...base, trigger: "format_ok", reason: withClearlyLabel(note, o.clearlyInfringing === true), clearlyInfringing: o.clearlyInfringing === true,
      });
    case "objected":
      return move(db, row, { ...base, trigger: decision === "accept" ? "ops_hide" : "ops_keep" });
    case "hidden":
      if (decision === "reject") return move(db, row, { ...base, trigger: "objection_accepted" });
      if (!row.objectionOpen) throw new CopyrightCaseError("conflict", "異議が出ていないため、確定は14日の経過を待ちます。");
      return move(db, row, { ...base, trigger: "objection_rejected" });
    case "inquiry":
      if (decision === "accept") {
        // 印なしで7日が過ぎて運営の列に戻った照会だけ、運営が非公開にできる。
        if (row.needsDecisionAt === null) throw new CopyrightCaseError("conflict", "投稿者の回答か7日の経過を待っています。");
        return move(db, row, { ...base, trigger: "ops_hide", where: { sql: "needs_decision_at IS NOT NULL", args: [] } });
      }
      return move(db, row, { ...base, trigger: "withdraw" });
    default:
      throw new CopyrightCaseError("forbidden_transition", "この申告はすでに終わっています。");
  }
}

/** 申告者が取り下げた（Rights Desk 経由）。照会前・照会中・判断待ちは閉じ、非公開なら元に戻す。 */
export async function withdrawTarget(db: D1Database, rowId: string, role: Role, note: string, o: OpsOptions = {}): Promise<CaseState> {
  const row = await requireTarget(db, rowId);
  return move(db, row, { trigger: "withdraw", role, reason: note, now: o.now ?? new Date().toISOString(), media: o.media, videoDeps: o.videoDeps });
}

// ---------------------------------------------------------------------------
// 投稿者の回答
// ---------------------------------------------------------------------------

export type SenderResponseKind = "agree" | "disagree" | "post_hide_objection";

/**
 * 投稿者の回答。本人（対象の投稿者）だけが、締切より前（異議は非公開から14日以内）に出せる。
 * 締切の瞬間以降は、定期処理が動く前でも拒む。
 */
export async function respondToCase(
  db: D1Database,
  input: { targetRowId: string; authorProfileId: string; kind: SenderResponseKind; body?: string },
  now = new Date().toISOString(),
): Promise<CaseState> {
  const row = await loadCopyrightTarget(db, input.targetRowId);
  // 本人以外には、あるかどうかも知らせない。
  if (!row || !row.authorId || row.authorId !== input.authorProfileId) throw new CopyrightCaseError("not_found", "申告が見つかりません。");
  const body = (input.body ?? "").trim();
  if (body.length > 2000 || (input.kind !== "agree" && body.length < 20)) {
    throw new CopyrightCaseError("invalid_input", "同意しない理由や異議は20〜2000字で書いてください。");
  }
  const responseRow = (won: Cond) => [db.prepare(`INSERT INTO copyright_case_responses (id, target_id, author_profile_id, kind, body, created_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE ${won.sql}`).bind(crypto.randomUUID(), row.id, input.authorProfileId, input.kind, body, now, ...won.args)];

  if (input.kind === "post_hide_objection") {
    if (!canObjectAfterHide(row.state, row.hiddenAt, now) || row.objectionOpen) {
      throw new CopyrightCaseError("deadline_passed", "異議を受け付けられる状態ではありません。");
    }
    const windowStart = new Date(Date.parse(now) - OBJECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const won: Cond = {
      sql: "EXISTS (SELECT 1 FROM copyright_case_targets WHERE id = ? AND state = 'hidden' AND objection_open = 1 AND updated_at = ?)",
      args: [row.id, now],
    };
    const results = await db.batch([
      db.prepare(`UPDATE copyright_case_targets SET objection_open = 1, updated_at = ?
        WHERE id = ? AND state = 'hidden' AND objection_open = 0 AND hidden_at > ?`).bind(now, row.id, windowStart),
      ...responseRow(won),
      db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
        SELECT ?, ?, ?, 'author', 'post_hide_objection', 'hidden', 'hidden', '', ? WHERE ${won.sql}`)
        .bind(crypto.randomUUID(), row.caseId, row.id, now, ...won.args),
    ]);
    if (Number((results[0] as { meta?: { changes?: number } }).meta?.changes ?? 0) !== 1) {
      throw new CopyrightCaseError("conflict", "他の処理が先に状態を変更しました。");
    }
    return "hidden";
  }

  if (!canRespondToInquiry(row.state, row.deadline, now)) {
    throw new CopyrightCaseError("deadline_passed", "回答の期限を過ぎているか、照会中ではありません。");
  }
  return move(db, row, {
    trigger: input.kind === "agree" ? "sender_agrees" : "sender_objects",
    role: "author",
    reason: input.kind,
    now,
    where: { sql: "inquiry_deadline_at > ?", args: [now] },
    extra: responseRow,
  });
}

// ---------------------------------------------------------------------------
// 定期処理
// ---------------------------------------------------------------------------

export type DeadlineRunResult = {
  hidden: number;
  /** 7日が過ぎたが「明らかな侵害」の印が無く、自動では隠さず運営の列に戻した数（Hub・Music・Vault の全対象）。 */
  needsDecision: number;
  finalized: number;
  reporterIdsCleared: number;
  conflicts: number;
  /** Music・Vault の対象：Rights Desk へ送り直した数、7日で hide を送った数、14日で finalize を送った数。 */
  external: { retried: number; hidden: number; finalized: number };
};

const JOB_BATCH = 50;

/**
 * 1 時間ごとの定期処理。
 * 1. 照会から7日たち、同意しない旨の申出がなく、運営が「明らかな侵害」と印を付けたものを非公開にする（対処法 3条2項2号）。
 *    印が無いものは隠さず、照会のまま運営の列（判断待ち）に戻す。
 * 2. 非公開から14日たち、異議のないものを確定する。
 * 3. 閉じてから3年たった事件の、申告者のプロフィールIDを消す。
 * どの検索も索引つきで LIMIT をかけ、残りは次の回に回す。再実行しても二重には動かない。
 */
export async function runCopyrightDeadlines(
  db: D1Database,
  o: { now?: string; media?: R2Bucket; videoDeps?: HubVideoDeps; limit?: number } = {},
): Promise<DeadlineRunResult> {
  const now = o.now ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(o.limit ?? JOB_BATCH, 200));
  const result: DeadlineRunResult = { hidden: 0, needsDecision: 0, finalized: 0, reporterIdsCleared: 0, conflicts: 0, external: { retried: 0, hidden: 0, finalized: 0 } };

  const due = await db.prepare(`SELECT id FROM copyright_case_targets
    WHERE state = 'inquiry' AND service = 'hub' AND clearly_infringing = 1 AND inquiry_deadline_at <= ?
    ORDER BY inquiry_deadline_at LIMIT ?`).bind(now, limit).all<{ id: string }>();
  for (const { id } of due.results ?? []) {
    try {
      const row = await loadCopyrightTarget(db, id);
      if (!row) continue;
      await move(db, row, {
        trigger: "deadline_elapsed", role: "system", reason: `照会から${INQUIRY_DAYS}日、同意しない旨の申出なし（${CLEARLY_INFRINGING_LABEL}の印あり）`, now,
        where: { sql: "inquiry_deadline_at <= ? AND clearly_infringing = 1", args: [now] }, media: o.media, videoDeps: o.videoDeps,
      });
      result.hidden += 1;
    } catch (error) {
      if (error instanceof CopyrightCaseError && (error.code === "conflict" || error.code === "forbidden_transition")) result.conflicts += 1;
      else throw error;
    }
  }

  result.needsDecision = await returnUnmarkedInquiriesToQueue(db, now, limit);

  const cutoff = new Date(Date.parse(now) - OBJECTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const final = await db.prepare(`SELECT id FROM copyright_case_targets
    WHERE state = 'hidden' AND service = 'hub' AND objection_open = 0 AND hidden_at <= ? ORDER BY hidden_at LIMIT ?`).bind(cutoff, limit).all<{ id: string }>();
  for (const { id } of final.results ?? []) {
    try {
      const row = await loadCopyrightTarget(db, id);
      if (!row) continue;
      await move(db, row, {
        trigger: "window_elapsed", role: "system", reason: `非公開から${OBJECTION_WINDOW_DAYS}日、異議なし`, now,
        where: { sql: "objection_open = 0", args: [] }, media: o.media, videoDeps: o.videoDeps,
      });
      result.finalized += 1;
    } catch (error) {
      if (error instanceof CopyrightCaseError && (error.code === "conflict" || error.code === "forbidden_transition")) result.conflicts += 1;
      else throw error;
    }
  }

  result.reporterIdsCleared = await clearExpiredReporterIds(db, now, limit);
  result.external = await runExternalSweep(db, now, limit);
  return result;
}

/**
 * 7日が過ぎたが「明らかな侵害」の印が無い照会を、運営の判断待ちに戻す。隠さない。state は inquiry のまま、
 * needs_decision_at だけを入れる（一度だけ）。同意しない旨の申出が先に入っていれば state が変わっていて、ここには当たらない。
 * Music・Vault の対象も同じ（Hub の表を動かすだけで、持ち主には何も送らない）。
 */
async function returnUnmarkedInquiriesToQueue(db: D1Database, now: string, limit: number): Promise<number> {
  const due = await db.prepare(`SELECT t.id, t.case_id AS caseId FROM copyright_case_targets t
    WHERE t.state = 'inquiry' AND t.clearly_infringing = 0 AND t.needs_decision_at IS NULL AND t.inquiry_deadline_at <= ?
    ORDER BY t.inquiry_deadline_at LIMIT ?`).bind(now, limit).all<{ id: string; caseId: string }>();
  let done = 0;
  for (const { id, caseId } of due.results ?? []) {
    const [update] = await db.batch([
      db.prepare(`UPDATE copyright_case_targets SET needs_decision_at = ?, updated_at = ?
        WHERE id = ? AND state = 'inquiry' AND clearly_infringing = 0 AND needs_decision_at IS NULL AND inquiry_deadline_at <= ?`)
        .bind(now, now, id, now),
      db.prepare(`INSERT INTO copyright_case_events (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
        SELECT ?, ?, ?, 'system', 'deadline_needs_decision', 'inquiry', 'inquiry', ?, ?
        WHERE EXISTS (SELECT 1 FROM copyright_case_targets WHERE id = ? AND state = 'inquiry' AND needs_decision_at = ?)
          AND NOT EXISTS (SELECT 1 FROM copyright_case_events WHERE target_id = ? AND action = 'deadline_needs_decision')`)
        .bind(crypto.randomUUID(), caseId, id, `照会から${INQUIRY_DAYS}日、「${CLEARLY_INFRINGING_LABEL}」の印が無いため自動では隠さず、運営の判断に戻した`, now, id, now, id),
    ]);
    if ((update.meta?.changes ?? 0) > 0) done += 1;
  }
  return done;
}

/** 閉じてから3年たった事件の申告者IDを NULL にする。旧い copyright_notices の同じ行も。 */
export async function clearExpiredReporterIds(db: D1Database, now: string, limit = JOB_BATCH): Promise<number> {
  const cutoff = new Date(Date.parse(now));
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - REPORTER_ID_RETENTION_YEARS);
  const expired = await db.prepare(`SELECT id, closed_at AS closedAt FROM copyright_cases
    WHERE reporter_profile_id IS NOT NULL AND closed_at IS NOT NULL AND closed_at <= ?
    ORDER BY closed_at LIMIT ?`).bind(cutoff.toISOString(), limit).all<{ id: string; closedAt: string }>();
  // 暦の 3 年（reporterIdRetentionEnd）と、念のため突き合わせる。
  const ids = (expired.results ?? [])
    .filter((row) => {
      const end = reporterIdRetentionEnd(row.closedAt);
      return end !== null && Date.parse(end) <= Date.parse(now);
    })
    .map((row) => row.id);
  if (ids.length === 0) return clearReceiptExpiredReporterData(db, now, limit);
  const marks = ids.map(() => "?").join(",");
  await db.batch([
    db.prepare(`UPDATE copyright_cases SET reporter_profile_id = NULL WHERE id IN (${marks})`).bind(...ids),
    db.prepare(`UPDATE copyright_notices SET reporter_profile_id = NULL WHERE id IN (${marks})`).bind(...ids),
  ]);
  return ids.length + (await clearReceiptExpiredReporterData(db, now, limit));
}

/** 受理から4年（閉じたかどうかによらない。2026-10-17 の決定）。 */
const RECEIPT_RETENTION_YEARS = 4;
const ERASED_TEXT = "（4年経過により消去）";

/**
 * 受理から4年たった事件は、閉じていなくても申告者IDを NULL にし、申告者に結び付く自由記述
 * （申告者の表示名・著作物の説明・根拠）を置き換える。事件・状態・時刻・追記だけの記録（events）には触れない。
 * 置き換え済みの行は選ばれないので繰り返しても同じ結果になる。
 */
async function clearReceiptExpiredReporterData(db: D1Database, now: string, limit: number): Promise<number> {
  const cutoff = new Date(Date.parse(now));
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RECEIPT_RETENTION_YEARS);
  const due = await db.prepare(`SELECT id FROM copyright_cases
    WHERE created_at <= ? AND (reporter_profile_id IS NOT NULL OR work_description <> ? OR claim_basis <> ? OR claimant_display_name <> ?)
    ORDER BY created_at LIMIT ?`).bind(cutoff.toISOString(), ERASED_TEXT, ERASED_TEXT, ERASED_TEXT, limit).all<{ id: string }>();
  const ids = (due.results ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;
  const marks = ids.map(() => "?").join(",");
  await db.batch([
    db.prepare(`UPDATE copyright_cases SET reporter_profile_id = NULL, claimant_display_name = ?, work_description = ?, claim_basis = ?
      WHERE id IN (${marks})`).bind(ERASED_TEXT, ERASED_TEXT, ERASED_TEXT, ...ids),
    db.prepare(`UPDATE copyright_notices SET reporter_profile_id = NULL WHERE id IN (${marks})`).bind(...ids),
  ]);
  return ids.length;
}

// ---------------------------------------------------------------------------
// 運営の列
// ---------------------------------------------------------------------------

export type CopyrightQueueRow = {
  id: string;
  reason: "copyright";
  details: string;
  status: string;
  createdAt: string;
  targetId: string;
  preview: string;
};

type QueueRaw = {
  id: string; state: string; created_at: string; target_id: string; target_kind: string;
  work_description: string; claim_basis: string; claimant: string; case_number: string; needs_decision_at: string | null;
};

const QUEUE_SELECT = `SELECT t.id, t.state, t.created_at, t.target_id, t.target_kind, t.needs_decision_at,
    c.work_description, c.claim_basis, c.claimant_display_name AS claimant, c.case_number
  FROM copyright_case_targets t JOIN copyright_cases c ON c.id = t.case_id`;

/**
 * 運営の通報の列に出す行。status は 'open'（運営の判断待ち：受付・同意しない旨・異議あり）、'all'、または状態名。
 * どれも索引（state, created_at）つきで 100 行まで。連絡先は持たないので出ない。
 */
export async function listCopyrightQueue(db: D1Database, status = "open"): Promise<CopyrightQueueRow[]> {
  const queries: Array<Promise<{ results?: QueueRaw[] }>> = [];
  const byState = (state: string) => db.prepare(`${QUEUE_SELECT} WHERE t.state = ? ORDER BY t.created_at DESC LIMIT 100`).bind(state).all<QueueRaw>();
  if (status === "open") {
    queries.push(byState("received"), byState("objected"));
    // 7日が過ぎても「明らかな侵害」の印が無く、自動では隠さずに運営へ戻した照会。
    queries.push(db.prepare(`${QUEUE_SELECT} WHERE t.state = 'inquiry' AND t.needs_decision_at IS NOT NULL ORDER BY t.created_at DESC LIMIT 100`).all<QueueRaw>());
    queries.push(db.prepare(`${QUEUE_SELECT} WHERE t.state = 'hidden' AND t.objection_open = 1 ORDER BY t.created_at DESC LIMIT 100`).all<QueueRaw>());
  } else if (status === "all") {
    for (const state of CASE_STATES) queries.push(byState(state));
  } else if (isCaseState(status)) {
    queries.push(byState(status));
  } else {
    return [];
  }
  const rows = (await Promise.all(queries)).flatMap((r) => r.results ?? []);
  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100)
    .map((row) => ({
      id: row.id,
      reason: "copyright" as const,
      details: `${row.work_description} / ${row.claim_basis}`.slice(0, 1000),
      status: row.state,
      createdAt: row.created_at,
      targetId: row.target_id,
      preview: `${row.claimant} / ${row.target_kind}:${row.target_id}${row.needs_decision_at ? " / 照会7日経過・判断待ち" : ""}`,
    }));
}

