import type { D1Database } from "@cloudflare/workers-types";

export async function publishDueCommunityMessages(database: D1Database, now = new Date().toISOString(), communityId?: string) {
  const due = await database.prepare(`SELECT id, channel_id, author_profile_id, body, kind, scheduled_at
    FROM community_scheduled_messages WHERE status = 'scheduled' AND scheduled_at <= ? AND (? IS NULL OR community_id = ?) ORDER BY scheduled_at LIMIT 50`)
    .bind(now, communityId ?? null, communityId ?? null).all<{ id: string; channel_id: string; author_profile_id: string; body: string; kind: "chat" | "guide" | "question" | "party"; scheduled_at: string }>();
  for (const item of due.results ?? []) {
    const messageId = `scheduled:${item.id}`;
    await database.batch([
      database.prepare(`INSERT OR IGNORE INTO community_channel_messages
        (id, channel_id, author_profile_id, body, created_at, reply_to_message_id, edited_at, kind, pinned_at, pinned_by_profile_id, workflow_status)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, 'open')`).bind(messageId, item.channel_id, item.author_profile_id, item.body, item.scheduled_at, item.kind),
      database.prepare(`UPDATE community_scheduled_messages SET status = 'published' WHERE id = ? AND status = 'scheduled'`).bind(item.id),
    ]);
  }
  return due.results?.length ?? 0;
}

export async function refreshCommunityDailyMetrics(database: D1Database, now = new Date(), communityId?: string) {
  const day = now.toISOString().slice(0, 10);
  await database.prepare(`INSERT INTO community_daily_metrics
    (community_id, metric_day, active_members, joins, leaves, posts, reports)
    SELECT c.id, ?,
      (SELECT count(DISTINCT m.author_profile_id) FROM community_channel_messages m JOIN community_channels ch ON ch.id = m.channel_id WHERE ch.community_id = c.id AND m.created_at >= ?),
      (SELECT count(*) FROM community_audit_log a WHERE a.community_id = c.id AND a.action IN ('member_joined','member_joined_invite','membership_approved') AND a.created_at >= ?),
      (SELECT count(*) FROM community_audit_log a WHERE a.community_id = c.id AND a.action = 'member_left' AND a.created_at >= ?),
      (SELECT count(*) FROM community_channel_messages m JOIN community_channels ch ON ch.id = m.channel_id WHERE ch.community_id = c.id AND m.created_at >= ?),
      (SELECT count(*) FROM community_message_reports r WHERE r.community_id = c.id AND r.created_at >= ?)
    FROM communities c WHERE c.lifecycle_status = 'active' AND (? IS NULL OR c.id = ?)
    ON CONFLICT(community_id, metric_day) DO UPDATE SET active_members = excluded.active_members, joins = excluded.joins,
      leaves = excluded.leaves, posts = excluded.posts, reports = excluded.reports`)
    .bind(day, `${day}T00:00:00.000Z`, `${day}T00:00:00.000Z`, `${day}T00:00:00.000Z`, `${day}T00:00:00.000Z`, `${day}T00:00:00.000Z`, communityId ?? null, communityId ?? null).run();
}
