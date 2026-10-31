import type { D1Database } from "@cloudflare/workers-types";

export async function countD1VisibleUnreadMessages(
  database: D1Database,
  profileId: string,
): Promise<number> {
  const result = await database.prepare(`SELECT COALESCE(sum(mine.unread_count), 0) AS total
    FROM conversation_participants mine
    WHERE mine.profile_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM conversation_participants other
        JOIN thread_user_controls control ON control.blocked = 1 AND (
          (control.owner_profile_id = mine.profile_id AND control.target_profile_id = other.profile_id)
          OR (control.owner_profile_id = other.profile_id AND control.target_profile_id = mine.profile_id)
        )
        WHERE other.conversation_id = mine.conversation_id AND other.profile_id <> mine.profile_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM conversation_participants other
        JOIN profile_moderation_status moderation
          ON moderation.profile_id = other.profile_id AND moderation.status = 'suspended'
        WHERE other.conversation_id = mine.conversation_id AND other.profile_id <> mine.profile_id
      )`).bind(profileId).first<{ total: number }>();
  return Number(result?.total ?? 0);
}
