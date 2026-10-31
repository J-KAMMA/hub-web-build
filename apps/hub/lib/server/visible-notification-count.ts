import type { D1Database } from "@cloudflare/workers-types";

import { COMMUNITY_NOTIFICATION_VISIBILITY_SCOPE } from "@/lib/server/community-notification-visibility-sql";

export async function countD1VisibleUnreadNotifications(
  database: D1Database,
  profileId: string,
  options: { excludeMessages?: boolean } = {},
): Promise<number> {
  const result = await database.prepare(`SELECT count(*) AS total
    FROM notifications
    WHERE receiver_profile_id = ? AND is_read = 0
      ${options.excludeMessages ? "AND notification_type <> 'message_received'" : ""}
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
  return Number(result?.total ?? 0);
}
