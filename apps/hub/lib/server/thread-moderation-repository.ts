import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { ThreadModerationReportView, ThreadPost, ThreadPostReport, ThreadPostRevision, ThreadReportReason } from "@/lib/domain";
import { createD1HubNotification } from "@/lib/server/d1-notification-events";
import { canManageThreadPost } from "@/lib/thread-post-moderation";
import { AUTO_HIDE_REPORT_THRESHOLD, NEW_ACCOUNT_AGE_MS } from "@/lib/thread-abuse-controls";

export type ModerationResolution = "resolved" | "dismissed";

type PostRow = {
  id: string;
  thread_id: string;
  post_no: number;
  author_profile_id: string | null;
  display_name: string;
  body: string;
  reply_to_post_id: string | null;
  created_at: string;
  is_anonymous: number;
  edited_at: string | null;
  deleted_at: string | null;
  moderated_at: string | null;
  moderation_reason: string | null;
};

function postFromRow(row: PostRow): ThreadPost {
  return {
    id: row.id,
    threadId: row.thread_id,
    no: row.post_no,
    authorProfileId: row.author_profile_id,
    displayName: row.display_name,
    body: row.deleted_at || row.moderated_at ? "" : row.body,
    replyToPostId: row.reply_to_post_id,
    createdAt: row.created_at,
    isAnonymous: Boolean(row.is_anonymous),
    editedAt: row.edited_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    moderatedAt: row.moderated_at ?? undefined,
    moderationReason: row.moderation_reason ?? undefined
  };
}

async function getPost(database: D1Database, postId: string): Promise<PostRow | null> {
  return database.prepare(`SELECT id, thread_id, post_no, author_profile_id, display_name, body,
    reply_to_post_id, created_at, is_anonymous, edited_at, deleted_at, moderated_at, moderation_reason
    FROM thread_posts WHERE id = ?`).bind(postId).first<PostRow>();
}

export async function getD1ThreadPostStates(database: D1Database, threadId: string): Promise<Map<string, ThreadPost>> {
  const result = await database.prepare(`SELECT id, thread_id, post_no, author_profile_id, display_name, body,
    reply_to_post_id, created_at, is_anonymous, edited_at, deleted_at, moderated_at, moderation_reason
    FROM thread_posts WHERE thread_id = ? ORDER BY post_no`).bind(threadId).all<PostRow>();
  return new Map((result.results ?? []).map((row) => [row.id, postFromRow(row)]));
}

export async function getD1UserControls(database: D1Database, ownerProfileId: string) {
  const result = await database.prepare(`SELECT target_profile_id, muted, blocked
    FROM thread_user_controls WHERE owner_profile_id = ?`).bind(ownerProfileId).all<{
      target_profile_id: string;
      muted: number;
      blocked: number;
    }>();
  return new Map((result.results ?? []).map((row) => [row.target_profile_id, {
    muted: Boolean(row.muted),
    blocked: Boolean(row.blocked)
  }]));
}

export class ThreadPostControlError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

const CONTROL_POST_GUARD = `p.author_profile_id = ? AND p.author_profile_id <> ?
  AND p.deleted_at IS NULL AND p.moderated_at IS NULL
  AND EXISTS (SELECT 1 FROM threads t JOIN boards b ON b.id=t.board_id WHERE t.id=p.thread_id)`;

async function controllablePost(database: D1Database, postId: string, ownerProfileId: string) {
  const post = await getPost(database, postId);
  if (!post || post.deleted_at || post.moderated_at) throw new ThreadPostControlError("thread_post_not_found", 404);
  if (!post.author_profile_id || post.author_profile_id === ownerProfileId) throw new ThreadPostControlError("thread_post_relationship_unavailable", 403);
  const allowed = await database.prepare(`SELECT 1 FROM thread_posts p WHERE p.id=? AND ${CONTROL_POST_GUARD}`)
    .bind(postId, post.author_profile_id, ownerProfileId).first();
  if (!allowed) throw new ThreadPostControlError("thread_post_relationship_unavailable", 403);
  return post;
}

/** The target is resolved from a post in the database, never from caller-supplied identity. */
export async function getD1ThreadPostControl(database: D1Database, postId: string, ownerProfileId: string) {
  const post = await controllablePost(database, postId, ownerProfileId);
  const row = await database.prepare(`SELECT muted,blocked FROM thread_user_controls WHERE owner_profile_id=? AND target_profile_id=?`)
    .bind(ownerProfileId, post.author_profile_id).first<{ muted: number; blocked: number }>();
  return { muted: Boolean(row?.muted), blocked: Boolean(row?.blocked) };
}

/** Set one preference idempotently, retaining the other preference. Web toggle stays separate. */
export async function setD1ThreadPostControl(database: D1Database, postId: string, kind: "mute" | "block", enabled: boolean, ownerProfileId: string) {
  const post = await controllablePost(database, postId, ownerProfileId);
  const value = enabled ? 1 : 0;
  const result = await database.prepare(`INSERT INTO thread_user_controls (owner_profile_id,target_profile_id,muted,blocked,updated_at)
    SELECT ?,p.author_profile_id,?,?,? FROM thread_posts p WHERE p.id=? AND ${CONTROL_POST_GUARD}
    ON CONFLICT(owner_profile_id,target_profile_id) DO UPDATE SET
      muted=CASE WHEN ?='mute' THEN excluded.muted ELSE muted END,
      blocked=CASE WHEN ?='block' THEN excluded.blocked ELSE blocked END,
      updated_at=excluded.updated_at`)
    .bind(ownerProfileId, kind === "mute" ? value : 0, kind === "block" ? value : 0, new Date().toISOString(),
      postId, post.author_profile_id, ownerProfileId, kind, kind).run();
  if (!result.meta.changes) throw new ThreadPostControlError("thread_post_relationship_unavailable", 403);
  return getD1ThreadPostControl(database, postId, ownerProfileId);
}

export type ThreadPostHistoryCursor = { postId: string; createdAt: string; id: string };

/** A bounded owner-only page; deleted posts retain their owner's revision history. */
export async function getD1ThreadPostHistoryPage(database: D1Database, postId: string, profileId: string, after?: ThreadPostHistoryCursor) {
  if (after && after.postId !== postId) throw new ThreadPostControlError("invalid_history_cursor", 400);
  const post = await getPost(database, postId);
  if (!post) throw new ThreadPostControlError("thread_post_not_found", 404);
  if (!canManageThreadPost({ authorProfileId: post.author_profile_id }, profileId)) throw new ThreadPostControlError("thread_post_history_forbidden", 403);
  const available = await database.prepare(`SELECT 1 FROM thread_posts p JOIN threads t ON t.id=p.thread_id
    JOIN boards b ON b.id=t.board_id WHERE p.id=? AND p.author_profile_id=?`).bind(postId, profileId).first();
  if (!available) throw new ThreadPostControlError("thread_post_not_found", 404);
  const result = await database.prepare(`SELECT id,post_id,body,created_at,edit_reason FROM thread_post_revisions
    WHERE post_id=? AND EXISTS (SELECT 1 FROM thread_posts p JOIN threads t ON t.id=p.thread_id
      JOIN boards b ON b.id=t.board_id WHERE p.id=thread_post_revisions.post_id AND p.author_profile_id=?)
    ${after ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
    ORDER BY created_at DESC,id DESC LIMIT 6`)
    .bind(postId, profileId, ...(after ? [after.createdAt, after.createdAt, after.id] : []))
    .all<{ id: string; post_id: string; body: string; created_at: string; edit_reason: string }>();
  const rows = result.results ?? [];
  const current = await getPost(database, postId);
  if (!current) throw new ThreadPostControlError("thread_post_not_found", 404);
  if (!canManageThreadPost({ authorProfileId: current.author_profile_id }, profileId)) throw new ThreadPostControlError("thread_post_history_forbidden", 403);
  return { revisions: rows.slice(0, 5).map(row => ({ id: row.id, postId: row.post_id, body: row.body, createdAt: row.created_at, editReason: row.edit_reason })), hasMore: rows.length > 5 };
}

export async function toggleD1UserControl(database: D1Database, postId: string, action: "mute" | "block", ownerProfileId: string) {
  const post = await getPost(database, postId);
  if (!post) throw new Error("Post does not exist.");
  if (!post.author_profile_id) throw new Error("This legacy anonymous author cannot be controlled.");
  if (post.author_profile_id === ownerProfileId) throw new Error("You cannot control your own profile.");
  const now = new Date().toISOString();
  const initialMuted = action === "mute" ? 1 : 0;
  const initialBlocked = action === "block" ? 1 : 0;
  await database.prepare(`INSERT INTO thread_user_controls
    (owner_profile_id, target_profile_id, muted, blocked, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_profile_id, target_profile_id) DO UPDATE SET
      muted = CASE WHEN ? = 'mute' THEN 1 - muted ELSE muted END,
      blocked = CASE WHEN ? = 'block' THEN 1 - blocked ELSE blocked END,
      updated_at = excluded.updated_at`).bind(
        ownerProfileId, post.author_profile_id, initialMuted, initialBlocked, now, action, action
      ).run();
  const control = await database.prepare(`SELECT muted, blocked FROM thread_user_controls
    WHERE owner_profile_id = ? AND target_profile_id = ?`).bind(ownerProfileId, post.author_profile_id).first<{ muted: number; blocked: number }>();
  if (!control) throw new Error("The user control could not be saved.");
  return { muted: Boolean(control.muted), blocked: Boolean(control.blocked) };
}

export async function reportD1ThreadPost(database: D1Database, input: {
  postId: string;
  reporterProfileId: string;
  reason: ThreadReportReason;
  details?: string;
}) {
  const post = await getPost(database, input.postId);
  if (!post) throw new Error("Post does not exist.");
  if (canManageThreadPost({ authorProfileId: post.author_profile_id }, input.reporterProfileId)) {
    throw new Error("You cannot report your own post.");
  }
  if (post.deleted_at || post.moderated_at) throw new Error("非表示の投稿は通報できません。");
  const existing = await database.prepare(`SELECT id FROM thread_post_reports
    WHERE post_id = ? AND reporter_profile_id = ? AND status = 'open'`).bind(input.postId, input.reporterProfileId).first<{ id: string }>();
  if (existing) return { reportId: existing.id, submitted: false };
  const id = `thread-report-${crypto.randomUUID()}`;
  const createdAt = new Date();
  await database.prepare(`INSERT INTO thread_post_reports
    (id, post_id, reporter_profile_id, reason, details, status, resolution_note, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, 'open', '', ?, NULL)`).bind(
      id, input.postId, input.reporterProfileId, input.reason, input.details?.trim() ?? "", createdAt.toISOString()
    ).run();

  const trustedBefore = new Date(createdAt.getTime() - NEW_ACCOUNT_AGE_MS).toISOString();
  const qualified = await database.prepare(`SELECT count(DISTINCT r.reporter_profile_id) AS total
    FROM thread_post_reports r JOIN profiles reporter ON reporter.id = r.reporter_profile_id
    WHERE r.post_id = ? AND r.status = 'open' AND reporter.joined_at <= ?`)
    .bind(input.postId, trustedBefore).first<{ total: number }>();
  let autoHidden = false;
  const configuredThreshold = await database.prepare("SELECT setting_value FROM thread_safety_settings WHERE setting_key='auto_hide_report_threshold'")
    .first<{ setting_value: number }>().catch(() => null);
  const autoHideThreshold = Math.max(3, Math.min(10, Number(configuredThreshold?.setting_value ?? AUTO_HIDE_REPORT_THRESHOLD)));
  if (Number(qualified?.total ?? 0) >= autoHideThreshold) {
    const moderatedAt = createdAt.toISOString();
    const results = await database.batch([
      database.prepare(`INSERT INTO thread_post_revisions (id, post_id, body, created_at)
        SELECT ?, id, body, ? FROM thread_posts WHERE id = ? AND deleted_at IS NULL AND moderated_at IS NULL`)
        .bind(`thread-revision-${crypto.randomUUID()}`, moderatedAt, input.postId),
      database.prepare(`UPDATE thread_posts SET moderated_at = ?, moderation_reason = ?
        WHERE id = ? AND deleted_at IS NULL AND moderated_at IS NULL`)
        .bind(moderatedAt, "複数の信頼済みユーザーからの通報により確認中", input.postId),
      database.prepare("UPDATE threads SET best_answer_post_id = NULL, solved_at = NULL WHERE best_answer_post_id = ?")
        .bind(input.postId),
    ]);
    autoHidden = Boolean(results[1]?.meta.changes);
    if (autoHidden && post.author_profile_id) {
      await database.prepare(`INSERT INTO notifications
        (id, receiver_profile_id, actor_profile_id, notification_type, target_type, target_id, text, is_read, created_at)
        VALUES (?, ?, NULL, 'system', 'thread_post', ?, ?, 0, ?)`)
        .bind(
          crypto.randomUUID(), post.author_profile_id, input.postId,
          "投稿は複数の通報を受けたため、運営確認が終わるまで非表示になっています。", moderatedAt,
        ).run();
    }
  }
  return { reportId: id, submitted: true, autoHidden, qualifiedReportCount: Number(qualified?.total ?? 0) };
}

export async function editD1ThreadPost(database: D1Database, postId: string, body: string, profileId: string, editReason = ""): Promise<ThreadPost> {
  const post = await getPost(database, postId);
  if (!post) throw new Error("Post does not exist.");
  if (!canManageThreadPost({ authorProfileId: post.author_profile_id }, profileId)) throw new Error("You can edit only your own post.");
  if (post.deleted_at) throw new Error("Deleted posts cannot be edited.");
  const normalizedBody = body.trim();
  if (post.body === normalizedBody) return postFromRow(post);
  const editedAt = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO thread_post_revisions (id, post_id, body, created_at, edit_reason) VALUES (?, ?, ?, ?, ?)`)
      .bind(`thread-revision-${crypto.randomUUID()}`, postId, post.body, editedAt, editReason.trim().slice(0, 300)),
    database.prepare(`UPDATE thread_posts SET body = ?, edited_at = ? WHERE id = ?`).bind(normalizedBody, editedAt, postId),
    database.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).bind(editedAt, post.thread_id)
  ]);
  return postFromRow({ ...post, body: normalizedBody, edited_at: editedAt });
}

export async function deleteD1ThreadPost(database: D1Database, postId: string, profileId: string): Promise<ThreadPost> {
  const post = await getPost(database, postId);
  if (!post) throw new Error("Post does not exist.");
  if (!canManageThreadPost({ authorProfileId: post.author_profile_id }, profileId)) throw new Error("You can delete only your own post.");
  if (post.deleted_at) return postFromRow(post);
  const deletedAt = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO thread_post_revisions (id, post_id, body, created_at) VALUES (?, ?, ?, ?)`)
      .bind(`thread-revision-${crypto.randomUUID()}`, postId, post.body, deletedAt),
    database.prepare(`UPDATE thread_posts SET deleted_at = ?, edited_at = ? WHERE id = ?`).bind(deletedAt, deletedAt, postId),
    database.prepare(`UPDATE threads SET best_answer_post_id = NULL, solved_at = NULL WHERE best_answer_post_id = ?`).bind(postId),
    database.prepare(`DELETE FROM reactions
      WHERE target_type = 'thread_post' AND target_id = ?`).bind(postId),
    database.prepare(`DELETE FROM bookmarks
      WHERE target_type = 'thread_post' AND target_id = ?`).bind(postId),
    database.prepare(`DELETE FROM thread_vote_reasons
      WHERE post_id = ?`).bind(postId),
    database.prepare(`DELETE FROM thread_post_votes
      WHERE post_id = ?`).bind(postId),
    database.prepare(`DELETE FROM content_tag_links
      WHERE target_type = 'thread_post' AND target_id = ?`).bind(postId),
    database.prepare(`DELETE FROM notifications
      WHERE target_type = 'thread_post' AND target_id = ?`).bind(postId),
    database.prepare(`UPDATE thread_notification_events
      SET status = 'skipped', delivered_at = ?
      WHERE post_id = ? AND status = 'pending'`).bind(deletedAt, postId)
  ]);
  return postFromRow({ ...post, edited_at: deletedAt, deleted_at: deletedAt });
}

export async function getD1ThreadPostRevisions(database: D1Database, postId: string, profileId: string): Promise<ThreadPostRevision[]> {
  const post = await getPost(database, postId);
  if (!post) throw new Error("Post does not exist.");
  if (!canManageThreadPost({ authorProfileId: post.author_profile_id }, profileId)) throw new Error("You can view history only for your own post.");
  const result = await database.prepare(`SELECT id, post_id, body, created_at, edit_reason FROM thread_post_revisions
    WHERE post_id = ? ORDER BY created_at DESC`).bind(postId).all<{ id: string; post_id: string; body: string; created_at: string; edit_reason: string }>();
  return (result.results ?? []).map((row) => ({ id: row.id, postId: row.post_id, body: row.body, createdAt: row.created_at, editReason: row.edit_reason }));
}

export async function listD1ModerationReports(database: D1Database, status: ThreadPostReport["status"] | "all" = "open"): Promise<ThreadModerationReportView[]> {
  const where = status === "all" ? "" : "WHERE r.status = ?";
  const statement = database.prepare(`SELECT r.id, r.post_id, r.reporter_profile_id, r.reason, r.details, r.status,
    r.resolution_note, r.created_at, r.resolved_at, p.post_no, p.thread_id, p.body AS post_body,
    p.deleted_at AS post_deleted_at, p.moderated_at AS post_moderated_at, p.display_name AS author_display_name, t.title AS thread_title,
    COALESCE(reporter.display_name, '削除済みユーザー') AS reporter_display_name
    FROM thread_post_reports r
    JOIN thread_posts p ON p.id = r.post_id
    JOIN threads t ON t.id = p.thread_id
    LEFT JOIN profiles reporter ON reporter.id = r.reporter_profile_id
    ${where} ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200`);
  const result = status === "all"
    ? await statement.all<Record<string, unknown>>()
    : await statement.bind(status).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => ({
    id: String(row.id),
    postId: String(row.post_id),
    reporterProfileId: String(row.reporter_profile_id),
    reason: row.reason as ThreadReportReason,
    details: String(row.details ?? ""),
    status: row.status as ThreadPostReport["status"],
    resolutionNote: String(row.resolution_note ?? ""),
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
    postNo: Number(row.post_no),
    threadId: String(row.thread_id),
    threadTitle: String(row.thread_title),
    postBody: row.post_deleted_at || row.post_moderated_at ? "" : String(row.post_body),
    postDeletedAt: row.post_deleted_at ? String(row.post_deleted_at) : undefined,
    postModeratedAt: row.post_moderated_at ? String(row.post_moderated_at) : undefined,
    authorDisplayName: String(row.author_display_name),
    reporterDisplayName: String(row.reporter_display_name)
  }));
}

export async function resolveD1ModerationReport(database: D1Database, reportId: string, resolution: ModerationResolution, note: string) {
  const report = await database.prepare(`SELECT r.reporter_profile_id reporterId,p.thread_id threadId
    FROM thread_post_reports r JOIN thread_posts p ON p.id=r.post_id
    WHERE r.id=? AND r.status='open'`).bind(reportId).first<{ reporterId: string; threadId: string }>();
  if (!report) throw new Error("Open report does not exist.");
  const resolvedAt = new Date().toISOString();
  const result = await database.prepare(`UPDATE thread_post_reports SET status = ?, resolution_note = ?, resolved_at = ?
    WHERE id = ? AND status = 'open'`).bind(resolution, note.trim(), resolvedAt, reportId).run();
  if (!result.meta.changes) throw new Error("Open report does not exist.");
  await createD1HubNotification(database, {
    receiverProfileId: report.reporterId,
    text: resolution === "resolved"
      ? "スレッド投稿への通報を確認し、必要な対応を行いました。"
      : "スレッド投稿への通報を確認しました。現時点では対応対象とは判断しませんでした。",
    route: `/threads/${encodeURIComponent(report.threadId)}`,
    dedupeKey: `moderation-report:${reportId}:${resolution}`,
    createdAt: resolvedAt,
  });
  return { id: reportId, status: resolution, resolutionNote: note.trim(), resolvedAt };
}

export async function hideD1ReportedPost(database: D1Database, reportId: string, note: string) {
  const report = await database.prepare(`SELECT r.post_id,r.reporter_profile_id reporterId,p.body,p.thread_id threadId
    FROM thread_post_reports r JOIN thread_posts p ON p.id = r.post_id
    WHERE r.id = ? AND r.status = 'open'`).bind(reportId).first<{ post_id: string; reporterId: string; body: string; threadId: string }>();
  if (!report) throw new Error("Open report does not exist.");
  const resolvedAt = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO thread_post_revisions (id, post_id, body, created_at) VALUES (?, ?, ?, ?)`)
      .bind(`thread-revision-${crypto.randomUUID()}`, report.post_id, report.body, resolvedAt),
    database.prepare(`UPDATE thread_posts SET moderated_at = ?, moderation_reason = ? WHERE id = ?`)
      .bind(resolvedAt, note.trim() || "コミュニティガイドライン違反", report.post_id),
    database.prepare(`UPDATE thread_post_reports SET status = 'resolved', resolution_note = ?, resolved_at = ? WHERE id = ?`)
      .bind(note.trim(), resolvedAt, reportId),
    database.prepare(`UPDATE threads SET best_answer_post_id = NULL, solved_at = NULL WHERE best_answer_post_id = ?`).bind(report.post_id)
  ]);
  await createD1HubNotification(database, {
    receiverProfileId: report.reporterId,
    text: "スレッド投稿への通報を確認し、必要な対応を行いました。",
    route: `/threads/${encodeURIComponent(report.threadId)}`,
    dedupeKey: `moderation-report:${reportId}:hidden`,
    createdAt: resolvedAt,
  });
  return { id: reportId, status: "resolved" as const, resolutionNote: note.trim(), resolvedAt, postId: report.post_id };
}
