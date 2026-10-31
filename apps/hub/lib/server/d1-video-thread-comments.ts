import type { D1Database } from "@cloudflare/workers-types";
import { createD1HubNotification } from "@/lib/server/d1-notification-events";
import { requireNoD1BlockBetween } from "@/lib/server/profile-blocks";

export interface VideoThreadComment {
  id: string;
  videoId: string;
  parentCommentId?: string;
  body: string;
  playbackSeconds?: number;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  likedByViewer: boolean;
  author: {
    profileId: string;
    handle: string;
    displayName: string;
    avatarUrl?: string;
  };
}

type CommentRow = {
  id: string;
  video_id: string;
  parent_comment_id: string | null;
  body: string;
  playback_seconds: number | null;
  created_at: string;
  updated_at: string;
  profile_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  like_count: number;
  liked_by_viewer: number;
};

export class InvalidVideoThreadCommentError extends Error {}
export class VideoThreadTargetNotFoundError extends Error {}

export function parseVideoThreadCommentInput(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new InvalidVideoThreadCommentError("コメントを入力してください。");
  }
  const body = Reflect.get(value, "body");
  const parentCommentId = Reflect.get(value, "parentCommentId");
  const playbackSecondsValue = Reflect.get(value, "playbackSeconds");
  if (typeof body !== "string" || !body.trim() || body.trim().length > 1000) {
    throw new InvalidVideoThreadCommentError("コメントは1文字以上1000文字以内で入力してください。");
  }
  if (parentCommentId !== undefined && parentCommentId !== null && typeof parentCommentId !== "string") {
    throw new InvalidVideoThreadCommentError("返信先が不正です。");
  }
  return {
    body: body.trim(),
    parentCommentId: typeof parentCommentId === "string" && parentCommentId ? parentCommentId : undefined,
    playbackSeconds: typeof playbackSecondsValue === "number" && Number.isFinite(playbackSecondsValue)
      ? Math.max(0, Math.min(604800, Math.trunc(playbackSecondsValue))) : undefined,
  };
}

function fromRow(row: CommentRow): VideoThreadComment {
  return {
    id: row.id,
    videoId: row.video_id,
    parentCommentId: row.parent_comment_id ?? undefined,
    body: row.body,
    playbackSeconds: row.playback_seconds ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    likeCount: Number(row.like_count ?? 0),
    likedByViewer: Number(row.liked_by_viewer ?? 0) > 0,
    author: {
      profileId: row.profile_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
    },
  };
}

export async function listD1VideoThreadComments(
  database: D1Database,
  videoId: string,
  viewerProfileId?: string,
): Promise<VideoThreadComment[]> {
  const result = await database.prepare(
    `SELECT c.id, c.video_id, c.parent_comment_id, c.body, c.playback_seconds, c.created_at, c.updated_at,
      p.id AS profile_id, p.handle, p.display_name, p.avatar_url,
      (SELECT COUNT(*) FROM video_thread_comment_likes likes WHERE likes.comment_id = c.id) AS like_count,
      (SELECT COUNT(*) FROM video_thread_comment_likes viewer_like
        WHERE viewer_like.comment_id = c.id AND viewer_like.profile_id = ?) AS liked_by_viewer
    FROM video_thread_comments c
    JOIN profiles p ON p.id = c.profile_id
    WHERE c.video_id = ? AND c.status = 'published'
      AND NOT EXISTS (
        SELECT 1
        FROM thread_user_controls control
        WHERE (
          control.owner_profile_id = ?
          AND control.target_profile_id = c.profile_id
          AND (control.muted = 1 OR control.blocked = 1)
        ) OR (
          control.owner_profile_id = c.profile_id
          AND control.target_profile_id = ?
          AND control.blocked = 1
        )
      )
    ORDER BY c.created_at ASC
    LIMIT 300`,
  ).bind(
    viewerProfileId ?? "",
    videoId,
    viewerProfileId ?? "",
    viewerProfileId ?? "",
  ).all<CommentRow>();
  return result.results.map(fromRow);
}

export async function createD1VideoThreadComment(
  database: D1Database,
  input: { videoId: string; profileId: string; body: string; parentCommentId?: string; playbackSeconds?: number },
  now = new Date(),
) {
  const video = await database.prepare(
    "SELECT id FROM external_videos WHERE id = ? AND status = 'active' LIMIT 1",
  ).bind(input.videoId).first<{ id: string }>();
  if (!video) throw new VideoThreadTargetNotFoundError("動画が見つかりません。");

  if (input.parentCommentId) {
    const parent = await database.prepare(
      `SELECT id, parent_comment_id, profile_id FROM video_thread_comments
       WHERE id = ? AND video_id = ? AND status = 'published' LIMIT 1`,
    ).bind(input.parentCommentId, input.videoId).first<{
      id: string;
      parent_comment_id: string | null;
      profile_id: string;
    }>();
    if (!parent) throw new VideoThreadTargetNotFoundError("返信先のコメントが見つかりません。");
    if (parent.parent_comment_id) {
      throw new InvalidVideoThreadCommentError("返信は元のコメントに対して投稿してください。");
    }
    await requireNoD1BlockBetween(database, input.profileId, parent.profile_id);
  }

  const timestamp = now.toISOString();
  const id = crypto.randomUUID();
  await database.prepare(
    `INSERT INTO video_thread_comments
      (id, video_id, parent_comment_id, profile_id, body, playback_seconds, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)`,
  ).bind(
    id,
    input.videoId,
    input.parentCommentId ?? null,
    input.profileId,
    input.body,
    input.playbackSeconds ?? null,
    timestamp,
    timestamp,
  ).run();
  if (input.parentCommentId) {
    const parent = await database.prepare("SELECT profile_id FROM video_thread_comments WHERE id = ? LIMIT 1")
      .bind(input.parentCommentId).first<{ profile_id: string }>();
    if (parent?.profile_id) await createD1HubNotification(database, {
      receiverProfileId: parent.profile_id,
      actorProfileId: input.profileId,
      text: "動画のコメントに返信が届きました。",
      route: `/videos/${encodeURIComponent(input.videoId)}`,
      dedupeKey: `video-comment-reply:${id}`,
      createdAt: timestamp,
    });
  }
  return listD1VideoThreadComments(database, input.videoId, input.profileId);
}

export async function setD1VideoThreadCommentLike(
  database: D1Database,
  input: { videoId: string; commentId: string; profileId: string; liked: boolean },
) {
  const comment = await database.prepare(
    `SELECT id, profile_id FROM video_thread_comments
     WHERE id = ? AND video_id = ? AND status = 'published' LIMIT 1`,
  ).bind(input.commentId, input.videoId).first<{ id: string; profile_id: string }>();
  if (!comment) throw new VideoThreadTargetNotFoundError("コメントが見つかりません。");
  if (input.liked) {
    await requireNoD1BlockBetween(database, input.profileId, comment.profile_id);
    await database.prepare(
      `INSERT OR IGNORE INTO video_thread_comment_likes (comment_id, profile_id, created_at)
       VALUES (?, ?, ?)`,
    ).bind(input.commentId, input.profileId, new Date().toISOString()).run();
    const owner = await database.prepare("SELECT profile_id FROM video_thread_comments WHERE id = ? LIMIT 1")
      .bind(input.commentId).first<{ profile_id: string }>();
    if (owner?.profile_id && owner.profile_id !== input.profileId) await createD1HubNotification(database, {
      receiverProfileId: owner.profile_id,
      actorProfileId: null,
      text: "動画のコメントにいいねが付きました。",
      route: `/videos/${encodeURIComponent(input.videoId)}`,
      dedupeKey: `video-comment-like:${input.commentId}`,
    });
  } else {
    await database.prepare(
      "DELETE FROM video_thread_comment_likes WHERE comment_id = ? AND profile_id = ?",
    ).bind(input.commentId, input.profileId).run();
  }
  return listD1VideoThreadComments(database, input.videoId, input.profileId);
}

export async function reportD1VideoThreadComment(
  database: D1Database,
  input: { videoId: string; commentId: string; profileId: string; reason: string },
) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 300) {
    throw new InvalidVideoThreadCommentError("通報理由は1文字以上300文字以内で入力してください。");
  }
  const comment = await database.prepare(
    `SELECT id FROM video_thread_comments
     WHERE id = ? AND video_id = ? AND status = 'published' LIMIT 1`,
  ).bind(input.commentId, input.videoId).first<{ id: string }>();
  if (!comment) throw new VideoThreadTargetNotFoundError("コメントが見つかりません。");
  await database.prepare(
    `INSERT INTO video_thread_comment_reports
      (id, comment_id, reporter_profile_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, 'open', ?)
     ON CONFLICT(comment_id, reporter_profile_id) DO UPDATE SET
       reason = excluded.reason, status = 'open', created_at = excluded.created_at`,
  ).bind(crypto.randomUUID(), input.commentId, input.profileId, reason, new Date().toISOString()).run();
}
