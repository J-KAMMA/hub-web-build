import { getHubD1 } from '@/lib/server/hub-d1';
import { requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { searchResearchLinks } from '@/lib/server/research-link-search';
import { clientResearchJson, clientResearchFailure } from '@/lib/server/client-research-route';
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db), query = new URL(request.url).searchParams;
    if (query.getAll('kind').length !== 1 || query.getAll('q').length > 1) return clientResearchJson({ error: '検索条件が不正です。' }, 400);
    return clientResearchJson(await searchResearchLinks(db, (await params).projectId, viewer.id, query.get('kind')!, query.get('q') ?? ''));
  } catch (error) { return clientResearchFailure(error); }
}
