import type { D1Database } from "@cloudflare/workers-types";

import type {
  NotificationContext,
  NotificationTargetType,
  NotificationType,
} from "@/lib/domain";
import { getD1NotificationPreferences } from "@/lib/server/d1-direct-messages";
import { notificationTextFor } from "@/lib/server/gated-exits";
import { hasD1BlockBetween } from "@/lib/server/profile-blocks";

type SocialNotificationPreference = "replies" | "reactions" | "follows";

export async function createD1SocialNotification(
  database: D1Database,
  input: {
    receiverProfileId: string;
    actorProfileId: string | null;
    safetyActorProfileId?: string | null;
    type: Extract<
      NotificationType,
      "social_reply" | "social_repost" | "social_reaction" | "thread_reply" | "followed"
    >;
    context?: NotificationContext;
    targetType: NotificationTargetType;
    targetId: string;
    text: string;
    preference: SocialNotificationPreference;
    createdAt: string;
  },
) {
  const safetyActorProfileId =
    input.safetyActorProfileId ?? input.actorProfileId;
  if (
    !input.receiverProfileId ||
    !input.targetId ||
    input.receiverProfileId === safetyActorProfileId
  ) {
    return false;
  }

  const preferences = await getD1NotificationPreferences(
    database,
    input.receiverProfileId,
  );
  if (!preferences[input.preference]) return false;

  const receiverSuspended = await database
    .prepare(`SELECT 1 AS suspended FROM profile_moderation_status
      WHERE profile_id = ? AND status = 'suspended' LIMIT 1`)
    .bind(input.receiverProfileId)
    .first<{ suspended: number }>();
  if (receiverSuspended) return false;

  if (safetyActorProfileId) {
    const actorSuspended = await database
      .prepare(`SELECT 1 AS suspended FROM profile_moderation_status
        WHERE profile_id = ? AND status = 'suspended' LIMIT 1`)
      .bind(safetyActorProfileId)
      .first<{ suspended: number }>();
    if (
      actorSuspended ||
      (await hasD1BlockBetween(
        database,
        input.receiverProfileId,
        safetyActorProfileId,
      ))
    ) {
      return false;
    }
  }

  const quoted = input.text.normalize("NFKC").trim().slice(0, 500);
  if (!quoted) return false;
  // Gated content is never quoted in a stored notification.
  const text = await notificationTextFor(
    database,
    { targetType: input.targetType, targetId: input.targetId },
    quoted,
  );

  const result = await database
    .prepare(`INSERT INTO notifications
      (id, receiver_profile_id, actor_profile_id, notification_type,
       notification_context, target_type, target_id, text, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
    .bind(
      crypto.randomUUID(),
      input.receiverProfileId,
      input.actorProfileId,
      input.type,
      input.context ?? null,
      input.targetType,
      input.targetId,
      text,
      input.createdAt,
    )
    .run();

  return Boolean(result.meta.changes);
}

export async function syncUnreadD1ReactionNotification(
  database: D1Database,
  input: {
    targetType: NotificationTargetType;
    targetId: string;
  },
) {
  const updated = await database
    .prepare(`UPDATE notifications
      SET aggregation_count = (
        SELECT count(*)
        FROM reactions
        WHERE target_type = ?
          AND target_id = ?
          AND kind = 'like'
      )
      WHERE notification_type = 'social_reaction'
        AND target_type = ?
        AND target_id = ?
        AND is_read = 0
        AND EXISTS (
          SELECT 1
          FROM reactions
          WHERE target_type = ?
            AND target_id = ?
            AND kind = 'like'
        )`)
    .bind(
      input.targetType,
      input.targetId,
      input.targetType,
      input.targetId,
      input.targetType,
      input.targetId,
    )
    .run();

  const removed = await database
    .prepare(`DELETE FROM notifications
      WHERE notification_type = 'social_reaction'
        AND target_type = ?
        AND target_id = ?
        AND is_read = 0
        AND NOT EXISTS (
          SELECT 1
          FROM reactions
          WHERE target_type = ?
            AND target_id = ?
            AND kind = 'like'
        )`)
    .bind(
      input.targetType,
      input.targetId,
      input.targetType,
      input.targetId,
    )
    .run();

  return {
    updated: Number(updated.meta.changes ?? 0),
    removed: Number(removed.meta.changes ?? 0),
  };
}
