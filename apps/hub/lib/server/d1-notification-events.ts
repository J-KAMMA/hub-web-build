import type { D1Database } from "@cloudflare/workers-types";

import { notificationTextFor } from "@/lib/server/gated-exits";

const ROUTE_PREFIXES = ["/", "/ai", "/articles", "/bbs", "/bookmarks", "/community", "/hubpedia", "/lists", "/music", "/notifications", "/posts", "/shopping", "/threads", "/vault", "/videos", "/work"];
const INVALID_BARE_ROUTES = new Set(["/posts", "/threads"]);

function safeRoute(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || INVALID_BARE_ROUTES.has(value) || !ROUTE_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`))) return "/notifications";
  return value.slice(0, 500);
}

export async function createD1HubNotification(database: D1Database, input: {
  receiverProfileId: string;
  actorProfileId?: string | null;
  text: string;
  route: string;
  dedupeKey: string;
  createdAt?: string;
  community?: {
    communityId: string;
    channelId: string;
    messageId: string;
    eventKind: "mention" | "reply";
  };
}) {
  if (!input.receiverProfileId || input.receiverProfileId === input.actorProfileId) return false;
  const quoted = input.text.normalize("NFKC").trim().slice(0, 500);
  if (!quoted) return false;
  const targetType = input.community ? "community_message" : "system";
  const targetId = input.community
    ? input.community.messageId
    : `${safeRoute(input.route)}#event=${encodeURIComponent(input.dedupeKey.slice(0, 160))}`;
  const notificationType = input.community ? "social_reply" : "system";
  const notificationContext =
    input.community?.eventKind === "mention" ? "mention" : null;
  const existing = await database.prepare(`SELECT id FROM notifications
    WHERE receiver_profile_id = ? AND notification_type = ? AND target_type = ? AND target_id = ? LIMIT 1`)
    .bind(
      input.receiverProfileId,
      notificationType,
      targetType,
      targetId,
    ).first<{ id: string }>();
  if (existing) return false;
  // Gated content (a message in a gated channel) is never quoted in a stored notification.
  const text = await notificationTextFor(database, { targetType, targetId }, quoted);
  const notificationId = crypto.randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const notification = database.prepare(`INSERT INTO notifications
    (id, receiver_profile_id, actor_profile_id, notification_type,
     notification_context, target_type, target_id, text, is_read, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, ?
    WHERE NOT EXISTS (SELECT 1 FROM notifications
      WHERE receiver_profile_id = ? AND notification_type = ? AND target_type = ? AND target_id = ?)`).bind(
      notificationId,
      input.receiverProfileId,
      input.actorProfileId ?? null,
      notificationType,
      notificationContext,
      targetType,
      targetId,
      text,
      createdAt,
      input.receiverProfileId, notificationType, targetType, targetId,
    );
  if (input.community) {
    const results = await database.batch([
      notification,
      database.prepare(`INSERT INTO community_notification_events
        (notification_id, community_id, channel_id, event_kind, created_at)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM notifications WHERE id = ?)`)
        .bind(
          notificationId,
          input.community.communityId,
          input.community.channelId,
          input.community.eventKind,
          createdAt,
          notificationId,
        ),
    ]);
    return Number(results[0]?.meta.changes ?? 0) > 0;
  } else {
    const result = await notification.run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}
