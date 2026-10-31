import type { D1Database } from "@cloudflare/workers-types";

async function ensureVideo(database: D1Database, videoId: string) {
  const video = await database.prepare("SELECT id FROM external_videos WHERE id = ? AND status = 'active' LIMIT 1").bind(videoId).first();
  if (!video) throw new Error("動画が見つかりません。");
}

export async function getD1VideoEngagement(database: D1Database, videoId: string, profileId?: string) {
  await ensureVideo(database, videoId);
  const [count, liked] = await Promise.all([
    database.prepare("SELECT COUNT(*) AS count FROM video_likes WHERE video_id = ?").bind(videoId).first<{ count: number }>(),
    profileId ? database.prepare("SELECT 1 AS liked FROM video_likes WHERE video_id = ? AND profile_id = ? LIMIT 1").bind(videoId, profileId).first() : null,
  ]);
  return { likeCount: Number(count?.count ?? 0), likedByViewer: Boolean(liked) };
}

export async function setD1VideoLike(database: D1Database, videoId: string, profileId: string, liked: boolean) {
  await ensureVideo(database, videoId);
  if (liked) await database.prepare("INSERT OR IGNORE INTO video_likes (video_id, profile_id, created_at) VALUES (?, ?, ?)").bind(videoId, profileId, new Date().toISOString()).run();
  else await database.prepare("DELETE FROM video_likes WHERE video_id = ? AND profile_id = ?").bind(videoId, profileId).run();
  return getD1VideoEngagement(database, videoId, profileId);
}

export async function reportD1Video(database: D1Database, videoId: string, profileId: string, reason: string, reasonCode: string | null = null) {
  const normalized = reason.trim();
  if (!normalized || normalized.length > 300) throw new Error("通報理由は1文字以上300文字以内で入力してください。");
  await ensureVideo(database, videoId);
  await database.prepare(`INSERT INTO video_reports (id, video_id, reporter_profile_id, reason, reason_code, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?)
    ON CONFLICT(video_id, reporter_profile_id) DO UPDATE SET reason=excluded.reason, reason_code=excluded.reason_code, status='open', created_at=excluded.created_at`)
    .bind(crypto.randomUUID(), videoId, profileId, normalized, reasonCode, new Date().toISOString()).run();
}
