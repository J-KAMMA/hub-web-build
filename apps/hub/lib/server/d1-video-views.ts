import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

export async function recordD1ExternalVideoView(
  database: D1Database,
  videoId: string,
  viewerHash: string,
  now = new Date()
): Promise<{ found: boolean; recorded: boolean; viewCount: number }> {
  const timestamp = now.toISOString();
  const viewDate = timestamp.slice(0, 10);
  const result = await database.prepare(`INSERT INTO external_video_views
      (video_id, viewer_hash, view_date, created_at)
    SELECT id, ?, ?, ?
    FROM external_videos
    WHERE id = ? AND status = 'active'
    ON CONFLICT(video_id, viewer_hash, view_date) DO NOTHING`)
    .bind(viewerHash, viewDate, timestamp, videoId)
    .run();

  // Views older than 90 days are folded into archived_view_count (privacy-retention.ts).
  const count = await database.prepare(`SELECT
      EXISTS(SELECT 1 FROM external_videos WHERE id = ? AND status = 'active') AS found,
      COALESCE((SELECT archived_view_count FROM external_videos WHERE id = ?), 0)
        + (SELECT COUNT(*) FROM external_video_views views WHERE views.video_id = ?) AS view_count`)
    .bind(videoId, videoId, videoId)
    .first<{ found: number; view_count: number }>();

  return {
    found: Boolean(count?.found),
    recorded: Number(result.meta.changes ?? 0) > 0,
    viewCount: Number(count?.view_count ?? 0)
  };
}
