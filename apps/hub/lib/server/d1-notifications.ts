import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Notification, NotificationContext, NotificationTargetType, NotificationType, Profile } from "@/lib/domain";
import { GATED_NOTIFICATION_TEXT, gatedTargetIds, redactGatedNotifications } from "@/lib/server/gated-exits";
import { COMMUNITY_NOTIFICATION_VISIBILITY_SCOPE } from "@/lib/server/community-notification-visibility-sql";

type NotificationRow = {
  id: string;
  receiver_profile_id: string;
  actor_profile_id: string | null;
  notification_type: NotificationType;
  notification_context?: NotificationContext | null;
  target_type: NotificationTargetType;
  target_id: string;
  text: string;
  is_read: number;
  created_at: string;
  last_event_at?: string | null;
  aggregation_count?: number;
};


function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    receiverProfileId: row.receiver_profile_id,
    actorProfileId: row.notification_type === "social_reaction" ? null : row.actor_profile_id,
    type: row.notification_type,
    context: row.notification_context ?? undefined,
    targetType: row.target_type,
    targetId: row.target_id,
    text: (row.aggregation_count ?? 1) > 1 ? `${row.text}（${row.aggregation_count}件）` : row.text,
    isRead: Boolean(row.is_read),
    createdAt: row.last_event_at ?? row.created_at,
  };
}

export type D1NotificationListOptions = {
  excludeMessageReceived?: boolean;
  limit?: number;
  /** "mentions": メンションと自分宛ての返信だけ（絞り込みはSQLで行う）。 */
  filter?: "mentions";
  /** 続きの位置。直前の頁の nextCursor をそのまま渡す。 */
  cursor?: string | null;
  /** true: 元の投稿の本文の頭（excerpt）を付ける。画面の通知だけが求める（MCP・AIの文脈・古いクライアントには付けない）。 */
  excerpts?: boolean;
};

export const NOTIFICATION_EXCERPT_MAX = 80;

/** 本文の頭を1行に縮める。空なら付けない。 */
export function notificationExcerpt(body: string | null | undefined): string | undefined {
  const flat = (body ?? "").replace(/\s+/gu, " ").trim();
  if (!flat) return undefined;
  const characters = [...flat];
  return characters.length > NOTIFICATION_EXCERPT_MAX
    ? `${characters.slice(0, NOTIFICATION_EXCERPT_MAX).join("")}…`
    : flat;
}

type ExcerptRow = {
  id: string;
  body: string;
  audience: string;
  author_profile_id: string | null;
  moderated_at: string | null;
  source_id: string | null;
  source_body: string | null;
  source_audience: string | null;
  source_author_profile_id: string | null;
  source_moderated_at: string | null;
};

const EXCERPT_CHUNK = 80;

/*
 * 通知の元の投稿（social_post）の本文の頭を付ける。X の通知の灰色の引用と同じ。
 * 付けるのは、閲覧条件（ゲート）が無く、非表示でなく、公開か受け手自身の投稿だけ。
 * 中身の無いリポストはリポスト元の本文を使うが、元にも同じ条件をかける。
 * ゲートの確認や読み出しに失敗したら、どれにも付けない（fail closed）。
 * 主キーでの IN 読みだけで、集計はしない。
 */
export async function attachD1NotificationExcerpts(
  database: D1Database,
  receiverProfileId: string,
  notifications: Notification[],
): Promise<Notification[]> {
  const postIds = [...new Set(notifications
    .filter((item) => item.targetType === "social_post" && item.text !== GATED_NOTIFICATION_TEXT)
    .map((item) => item.targetId))];
  if (!postIds.length) return notifications;
  try {
    const rows: ExcerptRow[] = [];
    for (let index = 0; index < postIds.length; index += EXCERPT_CHUNK) {
      const chunk = postIds.slice(index, index + EXCERPT_CHUNK);
      const result = await database.prepare(`SELECT post.id, post.body, post.audience, post.author_profile_id, post.moderated_at,
          source.id AS source_id, source.body AS source_body, source.audience AS source_audience,
          source.author_profile_id AS source_author_profile_id, source.moderated_at AS source_moderated_at
        FROM social_posts post
        LEFT JOIN social_posts source
          ON post.repost_of_target_type = 'social_post' AND source.id = post.repost_of_target_id
        WHERE post.id IN (${chunk.map(() => "?").join(", ")})`).bind(...chunk).all<ExcerptRow>();
      rows.push(...(result.results ?? []));
    }
    const gated = await gatedTargetIds(database, "post", rows.flatMap((row) => row.source_id ? [row.id, row.source_id] : [row.id]));
    const readable = (id: string | null, audience: string | null, author: string | null, moderatedAt: string | null) =>
      Boolean(id) && !gated.has(id!) && !moderatedAt && (audience === "public" || (author !== null && author === receiverProfileId));
    const excerpts = new Map<string, string>();
    for (const row of rows) {
      if (!readable(row.id, row.audience, row.author_profile_id, row.moderated_at)) continue;
      const own = notificationExcerpt(row.body);
      const excerpt = own ?? (readable(row.source_id, row.source_audience, row.source_author_profile_id, row.source_moderated_at)
        ? notificationExcerpt(row.source_body)
        : undefined);
      if (excerpt) excerpts.set(row.id, excerpt);
    }
    return notifications.map((item) => {
      const excerpt = item.targetType === "social_post" && item.text !== GATED_NOTIFICATION_TEXT ? excerpts.get(item.targetId) : undefined;
      return excerpt ? { ...item, excerpt } : item;
    });
  } catch {
    return notifications;
  }
}

/* メンション・返信の判定。クライアントの matchesNotificationTab("mentions") と同じ。 */
const MENTIONS_SCOPE = `AND (notification_context = 'mention' OR notification_type IN ('social_reply', 'thread_reply'))`;

type NotificationCursor = { at: string; id: string };

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id]), "utf8").toString("base64url");
}

export function decodeNotificationCursor(value: string | null | undefined): NotificationCursor | null {
  if (!value || value.length > 200) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [at, id] = parsed;
    if (typeof at !== "string" || typeof id !== "string" || !at || !id || at.length > 40 || id.length > 100) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export type D1NotificationPage = { notifications: Notification[]; nextCursor: string | null };

export async function listD1NotificationsPage(
  database: D1Database,
  profileId: string,
  options: D1NotificationListOptions = {},
): Promise<D1NotificationPage> {
  const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 200)));
  const messageScope = options.excludeMessageReceived
    ? "AND notification_type <> 'message_received'"
    : "";
  const filterScope = options.filter === "mentions" ? MENTIONS_SCOPE : "";
  const cursor = decodeNotificationCursor(options.cursor);
  // 頁送りをする呼び出し（filter か cursor がある）だけ、続きの有無のために1件多く読む。
  const paged = Boolean(options.filter || options.cursor);
  const cursorScope = cursor
    ? "AND (datetime(coalesce(last_event_at, created_at)) < datetime(?) OR (datetime(coalesce(last_event_at, created_at)) = datetime(?) AND id < ?))"
    : "";
  const bindings: unknown[] = [profileId];
  if (cursor) bindings.push(cursor.at, cursor.at, cursor.id);
  const result = await database.prepare(`SELECT id, receiver_profile_id, actor_profile_id, notification_type, notification_context,
    target_type, target_id, text, is_read, created_at, last_event_at, aggregation_count,
    datetime(coalesce(last_event_at, created_at)) AS sort_at FROM notifications
    WHERE receiver_profile_id = ?
    ${messageScope}
    ${filterScope}
    ${cursorScope}
    ${COMMUNITY_NOTIFICATION_VISIBILITY_SCOPE}
    AND (actor_profile_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM profile_moderation_status moderation
      WHERE moderation.profile_id = actor_profile_id AND moderation.status = 'suspended'
    ))
    AND (
      actor_profile_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE (
          (control.owner_profile_id = receiver_profile_id
            AND control.target_profile_id = actor_profile_id
            AND (control.muted = 1 OR control.blocked = 1))
          OR (control.owner_profile_id = actor_profile_id
            AND control.target_profile_id = receiver_profile_id
            AND control.blocked = 1)
        )
      )
    ) ORDER BY datetime(coalesce(last_event_at, created_at)) DESC, id DESC LIMIT ${paged ? limit + 1 : limit}`).bind(...bindings).all<NotificationRow & { sort_at: string }>();
  const rows = result.results;
  const hasMore = paged && rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  // Notifications about gated content never carry a quote of the body (DESIGN.md section 3).
  const redacted = await redactGatedNotifications(database, pageRows.map(mapNotification));
  return {
    notifications: options.excerpts !== true ? redacted : await attachD1NotificationExcerpts(database, profileId, redacted),
    nextCursor: hasMore && last ? encodeNotificationCursor({ at: last.sort_at, id: last.id }) : null,
  };
}

export async function listD1Notifications(
  database: D1Database,
  profileId: string,
  options: D1NotificationListOptions = {},
): Promise<Notification[]> {
  return (await listD1NotificationsPage(database, profileId, options)).notifications;
}

export async function countD1UnreadNotifications(
  database: D1Database,
  profileId: string,
  options: Pick<D1NotificationListOptions, "excludeMessageReceived"> = {},
): Promise<number> {
  const messageScope = options.excludeMessageReceived
    ? "AND notification_type <> 'message_received'"
    : "";
  const row = await database.prepare(`SELECT COUNT(*) AS total FROM notifications
    WHERE receiver_profile_id = ? AND is_read = 0
    ${messageScope}
    ${COMMUNITY_NOTIFICATION_VISIBILITY_SCOPE}
    AND (actor_profile_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM profile_moderation_status moderation
      WHERE moderation.profile_id = actor_profile_id AND moderation.status = 'suspended'
    ))
    AND (
      actor_profile_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE (
          (control.owner_profile_id = receiver_profile_id
            AND control.target_profile_id = actor_profile_id
            AND (control.muted = 1 OR control.blocked = 1))
          OR (control.owner_profile_id = actor_profile_id
            AND control.target_profile_id = receiver_profile_id
            AND control.blocked = 1)
        )
      )
    )`).bind(profileId).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function markAllD1NotificationsRead(
  database: D1Database,
  profileId: string,
  options: Pick<D1NotificationListOptions, "excludeMessageReceived" | "excerpts"> = {},
): Promise<Notification[]> {
  const messageScope = options.excludeMessageReceived
    ? "AND notification_type <> 'message_received'"
    : "";
  await database.prepare(`UPDATE notifications SET is_read = 1
    WHERE receiver_profile_id = ? AND is_read = 0 ${messageScope}`)
    .bind(profileId).run();
  return listD1Notifications(database, profileId, options);
}

export async function markD1NotificationRead(database: D1Database, profileId: string, notificationId: string): Promise<Notification | undefined> {
  await database.prepare(`UPDATE notifications SET is_read = 1
    WHERE id = ? AND receiver_profile_id = ?
    ${COMMUNITY_NOTIFICATION_VISIBILITY_SCOPE}
    AND (actor_profile_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM profile_moderation_status moderation
      WHERE moderation.profile_id = actor_profile_id AND moderation.status = 'suspended'
    ))
    AND (
      actor_profile_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE (
          (control.owner_profile_id = receiver_profile_id
            AND control.target_profile_id = actor_profile_id
            AND (control.muted = 1 OR control.blocked = 1))
          OR (control.owner_profile_id = actor_profile_id
            AND control.target_profile_id = receiver_profile_id
            AND control.blocked = 1)
        )
      )
    )`)
    .bind(notificationId, profileId).run();
  const row = await database.prepare(`SELECT id, receiver_profile_id, actor_profile_id, notification_type, notification_context,
    target_type, target_id, text, is_read, created_at, last_event_at, aggregation_count FROM notifications
    WHERE id = ? AND receiver_profile_id = ?
    ${COMMUNITY_NOTIFICATION_VISIBILITY_SCOPE}
    AND (actor_profile_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM profile_moderation_status moderation
      WHERE moderation.profile_id = actor_profile_id AND moderation.status = 'suspended'
    ))
    AND (
      actor_profile_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE (
          (control.owner_profile_id = receiver_profile_id
            AND control.target_profile_id = actor_profile_id
            AND (control.muted = 1 OR control.blocked = 1))
          OR (control.owner_profile_id = actor_profile_id
            AND control.target_profile_id = receiver_profile_id
            AND control.blocked = 1)
        )
      )
    )`).bind(notificationId, profileId).first<NotificationRow>();
  return row ? (await redactGatedNotifications(database, [mapNotification(row)]))[0] : undefined;
}

export async function getD1NotificationActors(database: D1Database, notifications: Notification[]): Promise<Profile[]> {
  const actorIds = [...new Set(notifications.flatMap((item) => item.actorProfileId ? [item.actorProfileId] : []))];
  if (!actorIds.length) return [];
  const placeholders = actorIds.map(() => "?").join(", ");
  const rows = await database.prepare(`SELECT id, handle, display_name, bio, avatar_url, joined_at
    FROM profiles WHERE id IN (${placeholders})`).bind(...actorIds).all<{
      id: string; handle: string; display_name: string; bio: string; avatar_url: string | null; joined_at: string;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined,
    joinedAt: row.joined_at,
  }));
}

export async function getD1ThreadPostDestinations(database: D1Database, notifications: Notification[]) {
  const postIds = [...new Set(notifications.filter((item) => item.targetType === "thread_post").map((item) => item.targetId))];
  if (!postIds.length) return {};
  const placeholders = postIds.map(() => "?").join(", ");
  const rows = await database.prepare(`SELECT id, thread_id, post_no FROM thread_posts
    WHERE id IN (${placeholders})`).bind(...postIds).all<{ id: string; thread_id: string; post_no: number }>();
  return Object.fromEntries(rows.results.map((row) => [
    row.id,
    `/threads/${row.thread_id}?replies=${encodeURIComponent(row.id)}#post-${row.post_no}`,
  ]));
}

export async function getD1CommunityMessageDestinations(
  database: D1Database,
  notifications: Notification[],
) {
  const messageIds = [...new Set(
    notifications
      .filter((item) => item.targetType === "community_message")
      .map((item) => item.targetId),
  )];
  if (!messageIds.length) return {};
  const placeholders = messageIds.map(() => "?").join(", ");
  const rows = await database.prepare(`SELECT
      message.id,
      channel.id AS channel_id,
      channel.community_id
    FROM community_channel_messages message
    JOIN community_channels channel ON channel.id = message.channel_id
    WHERE message.id IN (${placeholders})`)
    .bind(...messageIds)
    .all<{ id: string; channel_id: string; community_id: string }>();
  return Object.fromEntries(rows.results.map((row) => [
    row.id,
    `/community?community=${encodeURIComponent(row.community_id)}&channel=${encodeURIComponent(row.channel_id)}&message=${encodeURIComponent(row.id)}#${encodeURIComponent(row.id)}`,
  ]));
}
