import { getHubD1 } from '@/lib/server/hub-d1';
import { researchBacklinks } from '@/lib/server/research-workspace';
import { listPublicationUpdates } from '@/lib/server/publication-updates';
import { RESEARCH_LINK_KINDS, researchTargetId, type ResearchLinkKind } from '@/lib/research-workspace';
const json = (value: unknown, status = 200) => Response.json(value, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(request: Request) {
  const url = new URL(request.url), query = url.searchParams;
  const kind = query.get('kind') as ResearchLinkKind, id = query.get('id');
  const related = query.has('kind') || query.has('id');
  if ([...query.keys()].some(key => !['kind','id'].includes(key)) || (related && (query.getAll('kind').length !== 1 || query.getAll('id').length !== 1 || !RESEARCH_LINK_KINDS.includes(kind) || !id || id.includes('\uFFFD') || researchTargetId(kind,id,url.origin) !== id))) return json({error:'invalid_target'},400);
  try { decodeURIComponent(url.search.replace(/\+/g,' ')); } catch { return json({error:'invalid_target'},400); }
  try {
    const db = getHubD1();
    if (related) return json({projects:await researchBacklinks(db,kind,id!)});
    return json({updates:await listPublicationUpdates(db)});
  } catch { return json({error:'research_unavailable'},503); }
}
