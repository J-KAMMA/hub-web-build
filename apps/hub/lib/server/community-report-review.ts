import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { createD1HubNotification } from "./d1-notification-events";

export class CommunityReportReviewError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503) { super(message); }
}

const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const authorized = `EXISTS(SELECT 1 FROM communities current JOIN community_memberships manager ON manager.community_id=current.id
  WHERE current.id=r.community_id AND current.lifecycle_status='active' AND manager.profile_id=? AND manager.status='active'
  AND (manager.role='moderator' OR (manager.role='owner' AND current.owner_profile_id=manager.profile_id))
  AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=manager.profile_id AND moderation.status='suspended'))`;
const reportContext = `FROM community_message_reports r
  JOIN communities c ON c.id=r.community_id
  JOIN community_channels channel ON channel.id=r.channel_id AND channel.community_id=r.community_id
  JOIN community_channel_messages message ON message.id=r.message_id AND message.channel_id=channel.id
  JOIN profiles reporter ON reporter.id=r.reporter_profile_id
  LEFT JOIN profiles author ON author.id=message.author_profile_id`;
const summaryColumns = `r.id,reporter.display_name reporterName,r.reason,r.created_at createdAt,r.message_id messageId,r.channel_id channelId`;
type ReportSummary = { id: string; reporterName: string; reason: string; createdAt: string; messageId: string; channelId: string };
type ReportRow = ReportSummary & {
  status: "open" | "resolved" | "dismissed";
  messageBody: string;
  messageAuthorName: string;
  messageAuthorId: string | null;
  messageEditedAt: string | null;
  resolvedAt: string | null;
  reporterId: string;
  communitySlug: string;
};

function storageFailure(error: unknown): never {
  if (error instanceof CommunityReportReviewError) throw error;
  throw new CommunityReportReviewError("保存結果を確認できませんでした。同じ内容で再試行してください。", 503);
}

async function requireReviewer(db: D1Database, actor: Profile, communityId: string) {
  if (!validId(communityId)) throw new CommunityReportReviewError("コミュニティの指定が正しくありません。", 400);
  const reviewer = await db.prepare(`SELECT c.owner_profile_id ownerId,manager.role FROM communities c
    JOIN community_memberships manager ON manager.community_id=c.id
    WHERE c.id=? AND c.lifecycle_status='active' AND manager.profile_id=? AND manager.status='active'
    AND (manager.role='moderator' OR (manager.role='owner' AND c.owner_profile_id=manager.profile_id))
    AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=manager.profile_id AND moderation.status='suspended')`)
    .bind(communityId, actor.id).first<{ ownerId: string; role: "owner" | "moderator" }>();
  if (!reviewer) throw new CommunityReportReviewError("コミュニティの通報を審査する権限がありません。", 403);
  return reviewer;
}

function publicReport(row: ReportRow, actorId: string) {
  const { reporterId, communitySlug: _slug, ...report } = row;
  return { ...report, canResolve: row.status === "open" && reporterId !== actorId && row.messageAuthorId !== actorId };
}

async function loadReport(db: D1Database, actor: Profile, communityId: string, reportId: string) {
  const row = await db.prepare(`SELECT ${summaryColumns},r.status,message.body messageBody,
      COALESCE(author.display_name,'投稿者') messageAuthorName,message.author_profile_id messageAuthorId,
      message.edited_at messageEditedAt,r.resolved_at resolvedAt,r.reporter_profile_id reporterId,c.slug communitySlug ${reportContext}
    WHERE r.community_id=? AND r.id=? AND ${authorized}`)
    .bind(communityId, reportId, actor.id).first<ReportRow>();
  if (!row) throw new CommunityReportReviewError("通報が見つかりません。", 404);
  return row;
}

export function readCommunityReportOffset(params: URLSearchParams) {
  const values = params.getAll("offset");
  if (!values.length) return 0;
  const offset = Number(values[0]);
  if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(values[0]) || !Number.isSafeInteger(offset)) {
    throw new CommunityReportReviewError("ページ指定が正しくありません。", 400);
  }
  return offset;
}

export async function getCommunityReports(db: D1Database, actor: Profile, communityId: string, offset = 0) {
  try {
    const { role } = await requireReviewer(db, actor, communityId);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new CommunityReportReviewError("ページ指定が正しくありません。", 400);
    const rows = await db.prepare(`SELECT ${summaryColumns} ${reportContext}
      WHERE r.community_id=? AND r.status='open' AND ${authorized} ORDER BY r.created_at,r.id LIMIT 21 OFFSET ?`)
      .bind(communityId, actor.id, offset).all<ReportSummary>();
    return {
      communityId, viewerId: actor.id, role, reports: rows.results.slice(0, 20),
      page: { offset, hasMore: rows.results.length > 20, nextOffset: rows.results.length > 20 ? offset + 20 : null },
    };
  } catch (error) { storageFailure(error); }
}

export async function getCommunityReport(db: D1Database, actor: Profile, communityId: string, reportId: string) {
  try {
    const { role } = await requireReviewer(db, actor, communityId);
    if (!validId(reportId)) throw new CommunityReportReviewError("通報の指定が正しくありません。", 400);
    const row = await loadReport(db, actor, communityId, reportId);
    return { communityId, viewerId: actor.id, role, report: publicReport(row, actor.id) };
  } catch (error) { storageFailure(error); }
}

type SavedReview = { note: string; decision: "actioned" | "dismissed"; expectedCreatedAt: string; expectedMessageEditedAt: string | null; targetId: string; targetLabel: string; reporterId: string; communitySlug: string };
type Audit = { id: string; communityId: string; actorId: string; reporterId: string | null; action: string; detail: string; createdAt: string };

export async function resolveCommunityReport(db: D1Database, actor: Profile, communityId: string, reportId: string, payload: unknown) {
  try {
    const reviewer = await requireReviewer(db, actor, communityId);
    if (!validId(reportId) || !payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 5
      || Object.keys(payload).some((key) => !["operationId", "decision", "note", "expectedCreatedAt", "expectedMessageEditedAt"].includes(key))) {
      throw new CommunityReportReviewError("審査内容の指定が正しくありません。", 400);
    }
    const { operationId, decision, expectedCreatedAt, expectedMessageEditedAt, note: rawNote } = payload as Record<string, unknown>;
    const note = typeof rawNote === "string" ? rawNote.normalize("NFKC").trim() : "";
    if (typeof operationId !== "string" || !/^[A-Za-z0-9-]{16,80}$/.test(operationId)
      || (decision !== "actioned" && decision !== "dismissed")
      || typeof expectedCreatedAt !== "string" || !expectedCreatedAt.trim() || expectedCreatedAt.length > 80
      || (expectedMessageEditedAt !== null && (typeof expectedMessageEditedAt !== "string" || !expectedMessageEditedAt.trim() || expectedMessageEditedAt.length > 80))
      || note.length < 5 || note.length > 1000) {
      throw new CommunityReportReviewError("操作ID・判定・通報日時・投稿の編集日時・判断理由を確認してください。理由は5〜1000文字で入力してください。", 400);
    }
    const loadAudit = () => db.prepare(`SELECT id,community_id communityId,actor_profile_id actorId,
      target_profile_id reporterId,action,detail,created_at createdAt FROM community_audit_log WHERE id=?`)
      .bind(operationId).first<Audit>();
    const acknowledge = async (audit: Audit, replayed: boolean) => {
      let saved: SavedReview | null;
      try { saved = JSON.parse(audit.detail); } catch { saved = null; }
      if (audit.communityId !== communityId || audit.actorId !== actor.id || audit.action !== "resolve_report"
        || !saved || saved.targetId !== reportId || saved.decision !== decision || saved.note !== note
        || saved.expectedCreatedAt !== expectedCreatedAt || saved.expectedMessageEditedAt !== expectedMessageEditedAt
        || !validId(saved.reporterId) || audit.reporterId !== saved.reporterId
        || typeof saved.communitySlug !== "string" || typeof saved.targetLabel !== "string") {
        throw new CommunityReportReviewError("操作IDが別の操作で使用されています。", 409);
      }
      const current = await loadReport(db, actor, communityId, reportId);
      if (current.reporterId === actor.id || current.messageAuthorId === actor.id) {
        throw new CommunityReportReviewError("自分の通報や自分の投稿に関する通報は審査できません。", 403);
      }
      const status = saved.decision === "actioned" ? "resolved" : "dismissed";
      let notificationPending = false;
      // A failed notification cannot undo the committed review. The same retry repairs it idempotently.
      try {
        await createD1HubNotification(db, {
          receiverProfileId: saved.reporterId,
          text: status === "resolved"
            ? "通報を対応済みとして記録しました。投稿の削除やメンバーへの処分を示すものではありません。"
            : "コミュニティ投稿への通報を確認しました。現時点では対応対象とは判断しませんでした。",
          route: `/community?community=${encodeURIComponent(saved.communitySlug)}`,
          dedupeKey: `moderation-report:${reportId}:${status}`,
          createdAt: audit.createdAt,
        });
      } catch { notificationPending = true; }
      return {
        ok: true as const, report: publicReport(current, actor.id), notificationPending,
        receipt: { auditId: audit.id, action: "resolve_report" as const, targetId: reportId, targetLabel: saved.targetLabel, confirmedAt: audit.createdAt, replayed },
      };
    };
    const existing = await loadAudit();
    if (existing) return await acknowledge(existing, true);
    const row = await loadReport(db, actor, communityId, reportId);
    if (row.reporterId === actor.id || row.messageAuthorId === actor.id) {
      throw new CommunityReportReviewError("自分の通報や自分の投稿に関する通報は審査できません。", 403);
    }
    if (row.status !== "open" || row.createdAt !== expectedCreatedAt || row.messageEditedAt !== expectedMessageEditedAt) {
      throw new CommunityReportReviewError("通報が更新されたか、処理済みです。読み直して確認してください。", 409);
    }
    const status = decision === "actioned" ? "resolved" : "dismissed";
    const now = new Date().toISOString();
    const detail = JSON.stringify({ note, decision, expectedCreatedAt, expectedMessageEditedAt, targetId: reportId,
      targetLabel: `${row.reporterName}からの通報「${row.reason}」`, reporterId: row.reporterId, communitySlug: row.communitySlug, nonce: crypto.randomUUID() });
    await db.batch([
      db.prepare(`UPDATE community_message_reports AS r SET status=?,resolved_at=?,resolved_by_profile_id=?
        WHERE r.id=? AND r.community_id=? AND r.status='open' AND r.created_at=?
        AND r.reporter_profile_id=? AND r.reporter_profile_id<>? AND r.message_id=? AND r.channel_id=? AND r.reason=?
        AND NOT EXISTS(SELECT 1 FROM community_audit_log WHERE id=?) AND ${authorized}
        AND EXISTS(SELECT 1 FROM communities c JOIN community_memberships manager ON manager.community_id=c.id
          WHERE c.id=r.community_id AND c.owner_profile_id=? AND manager.profile_id=? AND manager.role=?)
        AND EXISTS(SELECT 1 FROM community_channels channel JOIN community_channel_messages message ON message.channel_id=channel.id
          WHERE channel.id=r.channel_id AND channel.community_id=r.community_id AND message.id=r.message_id
          AND message.author_profile_id IS ? AND (message.author_profile_id IS NULL OR message.author_profile_id<>?)
          AND message.edited_at IS ? AND message.body=?)`)
        .bind(status, now, actor.id, reportId, communityId, expectedCreatedAt, row.reporterId, actor.id, row.messageId, row.channelId, row.reason,
          operationId, actor.id, reviewer.ownerId, actor.id, reviewer.role, row.messageAuthorId, actor.id, expectedMessageEditedAt, row.messageBody),
      db.prepare(`INSERT INTO community_audit_log(id,community_id,actor_profile_id,target_profile_id,action,detail,created_at)
        SELECT ?,?,?,?,'resolve_report',?,? WHERE changes()=1`)
        .bind(operationId, communityId, actor.id, row.reporterId, detail, now),
    ]);
    const saved = await loadAudit();
    if (!saved) throw new CommunityReportReviewError("通報の状態や審査権限が変更されました。読み直して確認してください。", 409);
    return await acknowledge(saved, saved.detail !== detail);
  } catch (error) { storageFailure(error); }
}
