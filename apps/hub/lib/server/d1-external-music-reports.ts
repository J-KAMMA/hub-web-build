import type { D1Database } from '@cloudflare/workers-types';
import { MUSIC_WORKS } from '@/lib/music-catalog';

export class ExternalMusicWorkNotFoundError extends Error {}
const sampleIds = new Set(MUSIC_WORKS.map(work => work.id));

/** Hub external catalog reports never authorize operations on Music-owned tracks or samples. */
export async function reportD1ExternalMusicWork(database: D1Database, profileId: string, workId: string, reason: string, details: string) {
  if (/^music:/iu.test(workId) || sampleIds.has(workId)) throw new ExternalMusicWorkNotFoundError();
  const target = await database.prepare("SELECT id FROM music_works WHERE id = ? AND status = 'active' LIMIT 1").bind(workId).first();
  if (!target) throw new ExternalMusicWorkNotFoundError();
  const now = new Date().toISOString();
  const saved = await database.prepare(`INSERT INTO music_reports
    (id, music_work_id, reporter_profile_id, reason, details, status, created_at, updated_at)
    SELECT ?, id, ?, ?, ?, 'open', ?, ? FROM music_works WHERE id = ? AND status = 'active'
    ON CONFLICT(music_work_id, reporter_profile_id) DO UPDATE SET
      reason=excluded.reason, details=excluded.details, status='open', updated_at=excluded.updated_at`)
    .bind(`music-report:${crypto.randomUUID()}`, profileId, reason, details, now, now, workId).run();
  if (!saved.meta.changes) throw new ExternalMusicWorkNotFoundError();
}
