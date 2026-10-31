import type { D1Database } from "@cloudflare/workers-types";

export type VideoProfileActivity = {
  videoId: string;
  positionSeconds: number;
  durationSeconds: number;
  volume: number;
  muted: boolean;
  completed: boolean;
  hidden: boolean;
  lastViewedAt: string;
};

function integer(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function parseVideoProfileActivity(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("視聴状態が不正です。");
  const videoId = Reflect.get(value, "videoId");
  if (typeof videoId !== "string" || !videoId) throw new Error("動画IDが必要です。");
  return {
    videoId,
    positionSeconds: integer(Reflect.get(value, "positionSeconds"), 0, 604800),
    durationSeconds: integer(Reflect.get(value, "durationSeconds"), 0, 604800),
    volume: integer(Reflect.get(value, "volume"), 0, 100),
    muted: Reflect.get(value, "muted") === true,
    completed: Reflect.get(value, "completed") === true,
    hidden: Reflect.get(value, "hidden") === true,
  };
}

export async function listD1VideoProfileActivity(database: D1Database, profileId: string) {
  const result = await database.prepare(`SELECT video_id, position_seconds, duration_seconds, volume, muted, completed, hidden, last_viewed_at
    FROM video_profile_activity WHERE profile_id = ? ORDER BY last_viewed_at DESC LIMIT 500`)
    .bind(profileId).all<{ video_id: string; position_seconds: number; duration_seconds: number; volume: number; muted: number; completed: number; hidden: number; last_viewed_at: string }>();
  return result.results.map((row): VideoProfileActivity => ({
    videoId: row.video_id, positionSeconds: Number(row.position_seconds), durationSeconds: Number(row.duration_seconds),
    volume: Number(row.volume), muted: Boolean(row.muted), completed: Boolean(row.completed), hidden: Boolean(row.hidden), lastViewedAt: row.last_viewed_at,
  }));
}

export async function upsertD1VideoProfileActivity(database: D1Database, profileId: string, input: ReturnType<typeof parseVideoProfileActivity>) {
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO video_profile_activity
    (profile_id, video_id, position_seconds, duration_seconds, volume, muted, completed, hidden, last_viewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, video_id) DO UPDATE SET position_seconds=excluded.position_seconds,
      duration_seconds=excluded.duration_seconds, volume=excluded.volume, muted=excluded.muted,
      completed=excluded.completed, hidden=excluded.hidden, last_viewed_at=excluded.last_viewed_at`)
    .bind(profileId, input.videoId, input.positionSeconds, input.durationSeconds, input.volume, input.muted ? 1 : 0, input.completed ? 1 : 0, input.hidden ? 1 : 0, now).run();
}
