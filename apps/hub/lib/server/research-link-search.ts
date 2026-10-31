import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import { RESEARCH_LINK_KINDS, type ResearchLinkKind } from '@/lib/research-workspace';
import { getSeedHubpediaSearchResults } from '@/lib/encyclopedia/hubpedia-search-results';
import { getResearchProject } from './d1-research';
import { listUserArticles } from './d1-user-articles';
import { getD1SearchRouteData } from './d1-search-route-data';
import { ResearchWorkspaceError, resolveResearchLink } from './research-workspace';
import {listD1MusicWorksPage} from './d1-music';
import {MUSIC_WORKS} from '@/lib/music-catalog';

/** Reuse catalog search, then check the same public targets accepted by link writes. */
export async function searchResearchLinks(db: D1Database, projectId: string, viewer: string | undefined, kindInput: string, queryInput: string) {
  const kind = kindInput as ResearchLinkKind;
  const query = queryInput.normalize('NFKC').trim();
  if (!RESEARCH_LINK_KINDS.includes(kind) || query.length > 100 || query.split(/\s+/u).length > 8) {
    throw new ResearchWorkspaceError('種類と検索語を確認してください。');
  }
  const project = await getResearchProject(db, projectId, viewer);
  if (!project) throw new ResearchWorkspaceError('プロジェクトが見つかりません。', 404);
  if (project.ownerProfileId !== viewer) throw new ResearchWorkspaceError('編集権限がありません。', 403);
  let ids: string[];
  if (kind === 'hubpedia') {
    ids = (await getSeedHubpediaSearchResults(query, 20)).results.map(item => item.slug);
  } else if (kind === 'article') {
    ids = (await listUserArticles(db, { audience: 'general', limit: 20, query })).map(item => item.id);
  } else if(kind==='music') {
    const page=await listD1MusicWorksPage(db,20,0,[],[],query);
    ids=[...page.works,...MUSIC_WORKS.filter(work=>`${work.title} ${work.artist}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))].slice(0,20).map(work=>work.id);
  } else {
    const type = { video: 'videos', thread: 'threads', community: 'communities' } as const;
    const data = await getD1SearchRouteData(query, viewer, { from: '', to: '', maxPrice: '', currency: 'JPY', type: type[kind] });
    ids = data[type[kind]].map(item => item.id);
  }
  const links = await Promise.all([...new Set(ids)].filter(id => id.length <= 240).map(id => resolveResearchLink(db, kind, id)));
  return { links: links.filter(link => link !== null).slice(0, 20) };
}
