import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";

export class CommunityAppealReviewError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}

const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const statuses = ["active", "muted", "banned"], roles = ["owner", "moderator", "member"];
const auditKinds = "'member_mute','member_unmute','member_ban','member_promote','member_demote','member_timeout_expired','resolve_appeal','appeal_submitted'";
const auditScope = `community_id=? AND (target_profile_id=? OR CASE WHEN json_valid(detail) THEN json_extract(detail,'$.targetId')=? ELSE 0 END) AND action IN (${auditKinds})`;
type Membership = { ownerId: string; role: "owner" | "moderator" | "member" | null; status: "active" | "muted" | "banned" | null; suspended: number };
type Legacy = { id: string; actorId: string; action: string; reason: string; expiresAt: string | null; createdAt: string };
type AuditRow = { id: string; actorId: string; targetId: string | null; action: string; detail: string; createdAt: string };
type Snapshot = { communityId: string; profileId: string; membership: Membership; legacy: Legacy[]; audits: AuditRow[] };
type Sanction = { kind: "legacy" | "audit"; id: string; createdAt: string };
type AppealRow = { id: string; profileId: string; displayName: string; reason: string; status: string; createdAt: string; resolvedAt: string | null; resolutionNote: string; memberActionId: string | null; reviewedBy: string | null };
type Reviewer = { role: "owner" | "moderator"; ownerId: string };

function storageFailure(error: unknown): never {
  if (error instanceof CommunityAppealReviewError) throw error;
  throw new CommunityAppealReviewError("保存結果を確認できませんでした。同じ内容で再試行してください。", 503);
}
function jsonObject(value: string): Record<string, unknown> | null {
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
  catch { return null; }
}
function time(value: string) { return typeof value === "string" && value.length <= 80 ? Date.parse(value) : NaN; }
async function hash(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
const managerScope = `EXISTS(SELECT 1 FROM communities c JOIN community_memberships manager ON manager.community_id=c.id
  WHERE c.id=a.community_id AND c.lifecycle_status='active' AND manager.profile_id=? AND manager.status='active'
  AND (manager.role='moderator' OR (manager.role='owner' AND c.owner_profile_id=manager.profile_id))
  AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=manager.profile_id AND moderation.status='suspended'))`;

async function requireReviewer(db: D1Database, actor: Profile, communityId: string): Promise<Reviewer> {
  if (!validId(communityId)) throw new CommunityAppealReviewError("コミュニティの指定が正しくありません。", 400);
  const reviewer = await db.prepare(`SELECT c.owner_profile_id ownerId,manager.role FROM communities c
    JOIN community_memberships manager ON manager.community_id=c.id WHERE c.id=? AND c.lifecycle_status='active'
    AND manager.profile_id=? AND manager.status='active'
    AND (manager.role='moderator' OR (manager.role='owner' AND c.owner_profile_id=manager.profile_id))
    AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=manager.profile_id AND moderation.status='suspended')`)
    .bind(communityId, actor.id).first<Reviewer>();
  if (!reviewer) throw new CommunityAppealReviewError("異議申立てを審査する権限がありません。", 403);
  return reviewer;
}
async function loadAppeal(db: D1Database, actor: Profile, communityId: string, appealId: string) {
  const row = await db.prepare(`SELECT a.id,a.profile_id profileId,p.display_name displayName,a.reason,a.status,
    a.created_at createdAt,a.resolved_at resolvedAt,a.resolution_note resolutionNote,a.member_action_id memberActionId,a.reviewed_by_profile_id reviewedBy
    FROM community_moderation_appeals a JOIN profiles p ON p.id=a.profile_id WHERE a.community_id=? AND a.id=? AND ${managerScope}`)
    .bind(communityId, appealId, actor.id).first<AppealRow>();
  if (!row) throw new CommunityAppealReviewError("異議申立てが見つかりません。", 404);
  return row;
}
async function snapshot(db: D1Database, communityId: string, profileId: string): Promise<Snapshot> {
  const membership = await db.prepare(`SELECT c.owner_profile_id ownerId,m.role,m.status,
    CASE WHEN EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=p.id AND moderation.status='suspended') THEN 1 ELSE 0 END suspended
    FROM communities c JOIN profiles p ON p.id=? LEFT JOIN community_memberships m ON m.community_id=c.id AND m.profile_id=p.id
    WHERE c.id=? AND c.lifecycle_status='active'`).bind(profileId, communityId).first<Membership>();
  if (!membership) throw new CommunityAppealReviewError("コミュニティまたはプロフィールが見つかりません。", 404);
  const legacy = await db.prepare(`SELECT id,actor_profile_id actorId,action,reason,expires_at expiresAt,created_at createdAt
    FROM community_member_actions WHERE community_id=? AND target_profile_id=?`).bind(communityId, profileId).all<Legacy>();
  const audits = await db.prepare(`SELECT id,actor_profile_id actorId,target_profile_id targetId,action,detail,created_at createdAt
    FROM community_audit_log WHERE ${auditScope}`).bind(communityId, profileId, profileId).all<AuditRow>();
  // IDs only make the hash stable; chronology never uses an ID as a tie-breaker.
  return { communityId, profileId, membership, legacy: legacy.results.sort((a, b) => a.id.localeCompare(b.id)), audits: audits.results.sort((a, b) => a.id.localeCompare(b.id)) };
}

function stateDetail(audit: AuditRow) {
  const detail = jsonObject(audit.detail), before = detail?.before, after = detail?.after;
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return null;
  const prior = before as Record<string, unknown>, next = after as Record<string, unknown>;
  return typeof prior.role === "string" && typeof next.role === "string" && typeof prior.status === "string" && typeof next.status === "string"
    && roles.includes(prior.role) && roles.includes(next.role) && statuses.includes(prior.status) && statuses.includes(next.status)
    ? { detail, before: prior, after: next } : null;
}
function statusAudit(audit: AuditRow) {
  if (audit.action === "appeal_submitted") return false;
  if (!["member_promote", "member_demote"].includes(audit.action)) return true;
  const state = stateDetail(audit);
  return !state || state.before.status !== state.after.status
    || (audit.action === "member_promote" ? state.before.role !== "member" || state.after.role !== "moderator" : state.before.role !== "moderator" || state.after.role !== "member");
}
function currentSource(state: Snapshot): Sanction | null {
  const events = [
    ...state.legacy.filter((row) => row.action !== "warn").map((row) => ({ kind: "legacy" as const, id: row.id, createdAt: row.createdAt })),
    ...state.audits.filter(statusAudit).map((row) => ({ kind: "audit" as const, id: row.id, createdAt: row.createdAt })),
  ];
  if (!events.length || events.some((event) => !Number.isFinite(time(event.createdAt)))) return null;
  const latest = events.reduce((latest, event) => Math.max(latest, time(event.createdAt)), -Infinity), candidates = events.filter((event) => time(event.createdAt) === latest);
  if (candidates.length !== 1) return null;
  const source = candidates[0];
  if (source.kind === "legacy") {
    const row = state.legacy.find((row) => row.id === source.id)!;
    return row.action === "timeout" && state.membership.status === "muted" && row.expiresAt !== null && time(row.expiresAt) > Date.now() ? source : null;
  }
  const row = state.audits.find((row) => row.id === source.id)!, detail = stateDetail(row);
  if (!detail || row.targetId !== state.profileId || detail.detail?.targetId !== state.profileId || detail.before.role !== detail.after.role) return null;
  return row.action === "member_mute" && detail.before.status === "active" && detail.after.status === "muted" && state.membership.status === "muted"
    || row.action === "member_ban" && detail.before.status !== "banned" && detail.after.status === "banned" && state.membership.status === "banned" ? source : null;
}
function boundSource(state: Snapshot, appeal: AppealRow): Sanction | null {
  if (!Number.isFinite(time(appeal.createdAt))) return null;
  const proofs = state.audits.filter((row) => row.action === "appeal_submitted" && jsonObject(row.detail)?.targetId === appeal.id);
  let proof: Sanction | null = null;
  if (proofs.length) {
    if (proofs.length !== 1 || proofs[0].actorId !== appeal.profileId || proofs[0].targetId !== appeal.profileId
      || !Number.isFinite(time(proofs[0].createdAt)) || time(proofs[0].createdAt) < time(appeal.createdAt)) return null;
    const value = jsonObject(proofs[0].detail)?.sanction;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if ((source.kind !== "legacy" && source.kind !== "audit") || !validId(source.id) || typeof source.createdAt !== "string" || !Number.isFinite(time(source.createdAt)) || time(source.createdAt) > time(appeal.createdAt)) return null;
    proof = { kind: source.kind, id: source.id, createdAt: source.createdAt };
  }
  if (appeal.memberActionId) {
    const legacy = state.legacy.find((row) => row.id === appeal.memberActionId);
    if (!legacy || !Number.isFinite(time(legacy.createdAt)) || time(legacy.createdAt) > time(appeal.createdAt)
      || (proof && (proof.kind !== "legacy" || proof.id !== legacy.id || proof.createdAt !== legacy.createdAt))) return null;
    return { kind: "legacy", id: legacy.id, createdAt: legacy.createdAt };
  }
  return proof;
}
function sourceExpiry(state: Snapshot, source: Sanction | null) {
  return source?.kind === "legacy" ? state.legacy.find((row) => row.id === source.id && row.action === "timeout")?.expiresAt ?? null : null;
}
function mayManage(state: Snapshot, actor: Profile, reviewer: Reviewer) {
  return state.profileId !== actor.id && state.profileId !== state.membership.ownerId && state.membership.role !== "owner"
    && roles.includes(state.membership.role ?? "") && statuses.includes(state.membership.status ?? "") && (reviewer.role === "owner" || state.membership.role === "member");
}
function matchingSource(state: Snapshot, source: Sanction | null) {
  const latest = currentSource(state);
  return !!source && !!latest && latest.kind === source.kind && latest.id === source.id && latest.createdAt === source.createdAt;
}

function snapshotGuard(state: Snapshot, source: Sanction | null, excludeAuditId = "") {
  const legacy = JSON.stringify(state.legacy), audits = JSON.stringify(state.audits);
  const sql = `EXISTS(SELECT 1 FROM communities c JOIN profiles p ON p.id=?
    LEFT JOIN community_memberships m ON m.community_id=c.id AND m.profile_id=p.id
    WHERE c.id=? AND c.lifecycle_status='active' AND c.owner_profile_id=? AND m.role IS ? AND m.status IS ?
    AND CASE WHEN EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=p.id AND moderation.status='suspended') THEN 1 ELSE 0 END=?)
    AND (SELECT count(*) FROM community_member_actions WHERE community_id=? AND target_profile_id=?)=json_array_length(?)
    AND NOT EXISTS(SELECT 1 FROM community_member_actions row WHERE row.community_id=? AND row.target_profile_id=?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) old WHERE row.id=json_extract(old.value,'$.id') AND row.actor_profile_id=json_extract(old.value,'$.actorId')
        AND row.action=json_extract(old.value,'$.action') AND row.reason=json_extract(old.value,'$.reason') AND row.expires_at IS json_extract(old.value,'$.expiresAt') AND row.created_at=json_extract(old.value,'$.createdAt')))
    AND (SELECT count(*) FROM community_audit_log WHERE ${auditScope} AND id<>?)=json_array_length(?)
    AND NOT EXISTS(SELECT 1 FROM community_audit_log row WHERE ${auditScope} AND row.id<>?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) old WHERE row.id=json_extract(old.value,'$.id') AND row.actor_profile_id=json_extract(old.value,'$.actorId')
        AND row.target_profile_id IS json_extract(old.value,'$.targetId') AND row.action=json_extract(old.value,'$.action') AND row.detail=json_extract(old.value,'$.detail') AND row.created_at=json_extract(old.value,'$.createdAt')))`;
  const values: unknown[] = [state.profileId, state.communityId, state.membership.ownerId, state.membership.role, state.membership.status, state.membership.suspended,
    state.communityId, state.profileId, legacy, state.communityId, state.profileId, legacy,
    state.communityId, state.profileId, state.profileId, excludeAuditId, audits, state.communityId, state.profileId, state.profileId, excludeAuditId, audits];
  const expiry = sourceExpiry(state, source);
  return expiry && matchingSource(state, source) ? { sql: sql + " AND julianday(?)>julianday('now')", values: [...values, expiry] } : { sql, values };
}
async function sanctionPreview(state: Snapshot, appeal: AppealRow, actor: Profile, reviewer: Reviewer) {
  const source = boundSource(state, appeal), managed = mayManage(state, actor, reviewer);
  const eligible = state.membership.status === "muted" && !state.membership.suspended && matchingSource(state, source);
  const sanctionKey = await hash({ version: 1, state, source, eligible, appeal: {
    id: appeal.id, profileId: appeal.profileId, reason: appeal.reason, status: appeal.status, createdAt: appeal.createdAt,
    memberActionId: appeal.memberActionId, resolvedAt: appeal.resolvedAt, resolutionNote: appeal.resolutionNote, reviewedBy: appeal.reviewedBy,
  } });
  const restrictionReason = !managed ? "このメンバーの異議申立ては審査できません。"
    : state.membership.suspended ? "プロフィール全体の利用停止は解除されません。"
      : state.membership.status === "banned" ? "コミュニティからの除外は解除されません。"
        : !source ? "申立てと処分の結び付きが確認できないため、承認しても制限は解除されません。"
          : !eligible ? "元の処分が期限切れか更新済みのため、承認しても現在の制限は解除されません。" : "";
  const { reviewedBy: _reviewedBy, ...publicAppeal } = appeal;
  return { appeal: { ...publicAppeal, canResolve: appeal.status === "pending" && managed, canUnmute: appeal.status === "pending" && managed && eligible,
    sanctionKey, membershipStatus: state.membership.status, restrictionReason }, source, eligible };
}

export function readCommunityAppealOffset(params: URLSearchParams) {
  const values = params.getAll("offset"); if (!values.length) return 0;
  const offset = Number(values[0]);
  if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(values[0]) || !Number.isSafeInteger(offset)) throw new CommunityAppealReviewError("ページ指定が正しくありません。", 400);
  return offset;
}
export async function getCommunityAppeals(db: D1Database, actor: Profile, communityId: string, offset = 0) {
  try {
    const { role } = await requireReviewer(db, actor, communityId);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new CommunityAppealReviewError("ページ指定が正しくありません。", 400);
    const rows = await db.prepare(`SELECT a.id,p.display_name displayName,a.created_at createdAt FROM community_moderation_appeals a
      JOIN profiles p ON p.id=a.profile_id WHERE a.community_id=? AND a.status='pending' AND ${managerScope} ORDER BY a.created_at,a.id LIMIT 21 OFFSET ?`)
      .bind(communityId, actor.id, offset).all<{ id: string; displayName: string; createdAt: string }>();
    return { communityId, viewerId: actor.id, role, appeals: rows.results.slice(0, 20), page: { offset, hasMore: rows.results.length > 20, nextOffset: rows.results.length > 20 ? offset + 20 : null } };
  } catch (error) { storageFailure(error); }
}
export async function getCommunityAppeal(db: D1Database, actor: Profile, communityId: string, appealId: string) {
  try {
    const reviewer = await requireReviewer(db, actor, communityId);
    if (!validId(appealId)) throw new CommunityAppealReviewError("異議申立ての指定が正しくありません。", 400);
    const row = await loadAppeal(db, actor, communityId, appealId), state = await snapshot(db, communityId, row.profileId);
    return { communityId, viewerId: actor.id, role: reviewer.role, appeal: (await sanctionPreview(state, row, actor, reviewer)).appeal };
  } catch (error) { storageFailure(error); }
}

export async function getCommunityAppealSubmissionContext(db: D1Database, actor: Profile, communityId: string, memberActionId?: string, excludeAuditId = "") {
  try {
    if (!validId(communityId) || (memberActionId !== undefined && !validId(memberActionId))) throw new CommunityAppealReviewError("コミュニティまたは処分の指定が正しくありません。", 400);
    const state = await snapshot(db, communityId, actor.id);
    if (!state.membership.role || !state.membership.status || !roles.includes(state.membership.role) || !statuses.includes(state.membership.status) || state.membership.suspended) throw new CommunityAppealReviewError("異議申立てを送信できません。", 403);
    let sanction = currentSource(state);
    if (memberActionId) {
      const row = state.legacy.find((item) => item.id === memberActionId);
      if (!row) throw new CommunityAppealReviewError("処分が見つかりません。", 404);
      if (!Number.isFinite(time(row.createdAt))) throw new CommunityAppealReviewError("処分の日時を確認できません。", 409);
      sanction = { kind: "legacy", id: row.id, createdAt: row.createdAt };
    }
    return { sanction, sanctionKey: await hash({ version: 1, state, sanction }), membership: { role: state.membership.role, status: state.membership.status }, guard: snapshotGuard(state, sanction, excludeAuditId) };
  } catch (error) { storageFailure(error); }
}

export async function resolveCommunityAppeal(db: D1Database, actor: Profile, communityId: string, appealId: string, payload: unknown) {
  try {
    const reviewer = await requireReviewer(db, actor, communityId);
    const keys = ["operationId", "decision", "note", "expectedCreatedAt", "expectedSanctionKey"];
    if (!validId(appealId) || !payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== keys.length || Object.keys(payload).some((key) => !keys.includes(key))) throw new CommunityAppealReviewError("審査内容の指定が正しくありません。", 400);
    const { operationId, decision, expectedCreatedAt, expectedSanctionKey, note: rawNote } = payload as Record<string, unknown>;
    const note = typeof rawNote === "string" ? rawNote.normalize("NFKC").trim() : "";
    if (typeof operationId !== "string" || !/^[A-Za-z0-9-]{16,80}$/.test(operationId) || !["accepted", "rejected"].includes(String(decision)) || typeof decision !== "string"
      || typeof expectedCreatedAt !== "string" || !expectedCreatedAt.trim() || expectedCreatedAt.length > 80 || typeof expectedSanctionKey !== "string" || !/^[0-9a-f]{64}$/.test(expectedSanctionKey) || note.length < 5 || note.length > 1000) throw new CommunityAppealReviewError("操作ID・判定・申立て日時・制限状態・判断理由を確認してください。理由は5〜1000文字で入力してください。", 400);
    const loadAudit = () => db.prepare(`SELECT id,community_id communityId,actor_profile_id actorId,target_profile_id profileId,action,detail,created_at createdAt FROM community_audit_log WHERE id=?`)
      .bind(operationId).first<{ id: string; communityId: string; actorId: string; profileId: string | null; action: string; detail: string; createdAt: string }>();
    const acknowledge = async (audit: NonNullable<Awaited<ReturnType<typeof loadAudit>>>, replayed: boolean) => {
      const saved = jsonObject(audit.detail);
      if (audit.communityId !== communityId || audit.actorId !== actor.id || audit.action !== "resolve_appeal" || !saved || saved.targetId !== appealId || saved.decision !== decision || saved.note !== note || saved.expectedCreatedAt !== expectedCreatedAt || saved.expectedSanctionKey !== expectedSanctionKey
        || typeof saved.targetLabel !== "string" || typeof saved.membershipEffect !== "string" || !["unmuted", "unchanged"].includes(saved.membershipEffect)) throw new CommunityAppealReviewError("操作IDが別の操作で使用されています。", 409);
      const row = await loadAppeal(db, actor, communityId, appealId), state = await snapshot(db, communityId, row.profileId);
      if (audit.profileId !== row.profileId) throw new CommunityAppealReviewError("操作IDが別の操作で使用されています。", 409);
      if (!mayManage(state, actor, reviewer)) throw new CommunityAppealReviewError("このメンバーの異議申立ては審査できません。", 403);
      return { ok: true as const, appeal: (await sanctionPreview(state, row, actor, reviewer)).appeal,
        receipt: { auditId: audit.id, action: "resolve_appeal" as const, targetId: appealId, targetLabel: saved.targetLabel, confirmedAt: audit.createdAt, replayed, membershipEffect: saved.membershipEffect as "unmuted" | "unchanged" } };
    };
    const existing = await loadAudit(); if (existing) return await acknowledge(existing, true);
    const row = await loadAppeal(db, actor, communityId, appealId), state = await snapshot(db, communityId, row.profileId), preview = await sanctionPreview(state, row, actor, reviewer);
    if (!mayManage(state, actor, reviewer)) throw new CommunityAppealReviewError("このメンバーの異議申立ては審査できません。", 403);
    if (row.status !== "pending" || row.createdAt !== expectedCreatedAt || preview.appeal.sanctionKey !== expectedSanctionKey) throw new CommunityAppealReviewError("申立てや制限状態が更新されたか、処理済みです。読み直して確認してください。", 409);
    const unmute = decision === "accepted" && preview.eligible, now = new Date().toISOString();
    const detail = JSON.stringify({ note, decision, expectedCreatedAt, expectedSanctionKey, targetId: appealId, targetLabel: `${row.displayName}の異議申立て`, membershipEffect: unmute ? "unmuted" : "unchanged", nonce: crypto.randomUUID() });
    const guard = snapshotGuard(state, preview.source), after = snapshotGuard({ ...state, membership: { ...state.membership, status: unmute ? "active" : state.membership.status } }, null, operationId);
    const proof = "EXISTS(SELECT 1 FROM community_audit_log WHERE id=? AND detail=?)";
    const actorGuard = `EXISTS(SELECT 1 FROM communities c JOIN community_memberships manager ON manager.community_id=c.id WHERE c.id=? AND c.owner_profile_id=? AND c.lifecycle_status='active'
      AND manager.profile_id=? AND manager.role=? AND manager.status='active' AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=manager.profile_id AND moderation.status='suspended'))`;
    const actorValues = [communityId, reviewer.ownerId, actor.id, reviewer.role];
    const statements = [db.prepare(`UPDATE community_moderation_appeals SET status=?,reviewed_by_profile_id=?,resolution_note=?,resolved_at=?
      WHERE id=? AND community_id=? AND profile_id=? AND member_action_id IS ? AND reason=? AND status='pending' AND created_at=? AND resolved_at IS ? AND resolution_note=? AND reviewed_by_profile_id IS ?
      AND NOT EXISTS(SELECT 1 FROM community_audit_log WHERE id=?) AND ${guard.sql} AND ${actorGuard}`)
      .bind(decision, actor.id, note, now, appealId, communityId, row.profileId, row.memberActionId, row.reason, expectedCreatedAt, row.resolvedAt, row.resolutionNote, row.reviewedBy, operationId, ...guard.values, ...actorValues),
    db.prepare(`INSERT INTO community_audit_log(id,community_id,actor_profile_id,target_profile_id,action,detail,created_at)
      SELECT ?,?,?,?,'resolve_appeal',?,? WHERE changes()=1`).bind(operationId, communityId, actor.id, row.profileId, detail, now)];
    if (unmute) statements.push(db.prepare(`UPDATE community_memberships SET status='active' WHERE community_id=? AND profile_id=? AND status='muted' AND role=? AND ${proof} AND ${guard.sql} AND ${actorGuard}`)
      .bind(communityId, row.profileId, state.membership.role, operationId, detail, ...snapshotGuard(state, preview.source, operationId).values, ...actorValues));
    // A trigger that ignores an audit or member update must roll back the decision too.
    statements.push(db.prepare(`SELECT CASE WHEN (${proof} AND NOT (${after.sql} AND ${actorGuard}
        AND EXISTS(SELECT 1 FROM community_moderation_appeals WHERE id=? AND community_id=? AND profile_id=? AND status=? AND reviewed_by_profile_id=? AND resolution_note=? AND resolved_at=? AND reason=? AND member_action_id IS ? AND created_at=?)))
      OR (EXISTS(SELECT 1 FROM community_moderation_appeals WHERE id=? AND status=? AND reviewed_by_profile_id=? AND resolved_at=?) AND NOT (${proof}))
      THEN json('invalid-appeal-transaction') ELSE 1 END`)
      .bind(operationId, detail, ...after.values, ...actorValues, appealId, communityId, row.profileId, decision, actor.id, note, now, row.reason, row.memberActionId, row.createdAt, appealId, decision, actor.id, now, operationId, detail));
    await db.batch(statements);
    const saved = await loadAudit(); if (!saved) throw new CommunityAppealReviewError("申立ての状態や審査権限が変更されました。読み直して確認してください。", 409);
    return await acknowledge(saved, saved.detail !== detail);
  } catch (error) { storageFailure(error); }
}
