import type { D1Database } from "@cloudflare/workers-types";
import { lookupExternalVideoMetadata } from "@/lib/server/video-metadata";
import { classifyVideoBroadcastStatus } from "@/lib/video-broadcast-status";

type Candidate = { id: string; source_url: string; title: string; topic: string; availability_failures: number };

export async function maintainVideoAvailability(database: D1Database, fetcher: typeof fetch = fetch, limit = 25) {
  const rows = await database.prepare(`SELECT id, source_url, title, topic, availability_failures FROM external_videos
    WHERE status='active' AND (availability_checked_at IS NULL OR availability_checked_at < ?)
    ORDER BY COALESCE(availability_checked_at,'') ASC LIMIT ?`)
    .bind(new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), Math.max(1, Math.min(100, limit))).all<Candidate>();
  let unavailable = 0;
  for (const video of rows.results) {
    let available = false;
    try {
      const response = await fetcher(video.source_url, { method: "GET", redirect: "follow", headers: { range: "bytes=0-0", "user-agent": "JKamma-Hub-Availability/1.0" }, signal: AbortSignal.timeout(8000) });
      available = response.ok || response.status === 206 || response.status === 403;
      await response.body?.cancel();
    } catch { available = false; }
    const failures = available ? 0 : Number(video.availability_failures ?? 0) + 1;
    const status = available ? "available" : failures >= 3 ? "unavailable" : "unknown";
    if (status === "unavailable") unavailable++;
    const metadata = available ? await lookupExternalVideoMetadata(video.source_url, fetcher) : null;
    const now = new Date().toISOString();
    await database.prepare("UPDATE external_videos SET availability_status=?, availability_failures=?, availability_checked_at=?, title=COALESCE(?, title), channel=COALESCE(?, channel), thumbnail_url=COALESCE(?, thumbnail_url), broadcast_status=?, metadata_checked_at=?, updated_at=? WHERE id=?")
      .bind(status, failures, now, metadata?.title ?? null, metadata?.channel ?? null, metadata?.thumbnailUrl ?? null, metadata?.broadcastStatus ?? classifyVideoBroadcastStatus({ title: metadata?.title ?? video.title, topic: video.topic }), now, now, video.id).run();
  }
  return { checked: rows.results.length, unavailable };
}
