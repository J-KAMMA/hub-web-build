import type { D1Database } from "@cloudflare/workers-types";
import { createD1HubNotification } from "@/lib/server/d1-notification-events";

/** Closes expired public listings and sends one deduplicated owner notification. */
export async function maintainExpiredWorkListings(database: D1Database, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const expired = await database.prepare(`SELECT id, owner_profile_id ownerProfileId, title
    FROM work_listings WHERE status='published' AND deadline IS NOT NULL AND deadline < ? LIMIT 250`).bind(today)
    .all<{ id: string; ownerProfileId: string; title: string }>();
  let closed = 0;
  for (const listing of expired.results) {
    const result = await database.prepare(`UPDATE work_listings SET status='paused', updated_at=?
      WHERE id=? AND status='published' AND deadline IS NOT NULL AND deadline < ?`).bind(now.toISOString(), listing.id, today).run();
    if (!result.meta.changes) continue;
    closed += 1;
    await createD1HubNotification(database, {
      receiverProfileId: listing.ownerProfileId,
      text: `募集期限を迎えた「${listing.title.slice(0, 80)}」の受付を終了しました。`,
      route: `/work?view=manage&listing=${encodeURIComponent(listing.id)}`,
      dedupeKey: `work-expired:${listing.id}:${today}`,
      createdAt: now.toISOString(),
    });
  }
  return { checked: expired.results.length, closed };
}
