import { musicWorkHref } from "@/lib/music-work-href";
import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import { listResearchUpdates } from './research-workspace';
import { publicVideoOriginSql } from './video-public-origin';

export type PublicationUpdate = {
  id: string; title: string; kind: string; href: string; updatedAt: string;
  projectId?: string; projectTitle?: string; version?: number;
};

// Public catalog metadata only. Each canonical work contributes one latest card;
// private bodies, service identities and audio objects never enter this response.
export async function listPublicationUpdates(db: D1Database): Promise<PublicationUpdate[]> {
  const [research, works] = await Promise.all([
    listResearchUpdates(db),
    db.prepare(`SELECT * FROM (
      SELECT id,title,'article' kind,updated_at updatedAt FROM hub_user_articles
        WHERE status='published' AND audience='general' AND moderated_at IS NULL
        ORDER BY updated_at DESC,id DESC LIMIT 20
    ) UNION ALL SELECT * FROM (
      SELECT id,title,'video' kind,created_at updatedAt FROM external_videos v
        WHERE status='active' AND safety_level='standard' AND availability_status<>'unavailable'
          AND ${publicVideoOriginSql('v')}
        ORDER BY created_at DESC,id DESC LIMIT 20
    ) UNION ALL SELECT * FROM (
      SELECT id,title,'music' kind,created_at updatedAt FROM music_works w
        WHERE status='active' AND EXISTS(SELECT 1 FROM music_service_links l
          WHERE l.music_work_id=w.id AND l.provider='youtube' AND l.embed_url IS NOT NULL
            AND l.availability_status<>'unavailable')
        ORDER BY created_at DESC,id DESC LIMIT 20
    )`).all<{id:string;title:string;kind:string;updatedAt:string}>(),
  ]);
  return [
    ...research.map(item => ({...item,kind:'research'})),
    ...works.results.map(item => ({...item, href: item.kind==='music'
      ? musicWorkHref(item.id)
      : `/v2/${item.kind==='article'?'articles':'videos'}/${encodeURIComponent(item.id)}`})),
  ].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)).slice(0,20);
}
