import { getHubD1 } from '@/lib/server/hub-d1';
import { getOptionalDesktopHubProfile, requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { readResearchWorkspace, mutateResearchWorkspace } from '@/lib/server/research-workspace';
import { clientResearchJson, clientResearchFailure, readClientResearchInput } from '@/lib/server/client-research-route';
import { prepareResearchDiscussion, createResearchDiscussion } from '@/lib/server/research-discussion';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const db = getHubD1(), viewer = await getOptionalDesktopHubProfile(request, db);
    const projectId = (await params).projectId;
    const query = new URL(request.url).searchParams;
    if (query.has('discussion')) {
      if (query.has('document') || query.has('linkKind') || query.getAll('discussion').length !== 1 || query.getAll('version').length !== 1 || !/^[1-9][0-9]*$/.test(query.get('version')!)) return clientResearchJson({ error: '参照する文書と版を指定してください。' }, 400);
      return clientResearchJson(await prepareResearchDiscussion(db, projectId, query.get('discussion')!, Number(query.get('version')), viewer?.id));
    }
    return clientResearchJson(await readResearchWorkspace(db, projectId, viewer?.id));
  } catch (error) { return clientResearchFailure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db);
    const projectId = (await params).projectId, input = await readClientResearchInput(request);
    return clientResearchJson(input.action === 'discuss' ? await createResearchDiscussion(db, projectId, viewer, input) : await mutateResearchWorkspace(db, projectId, viewer.id, input, new URL(request.url).origin));
  } catch (error) { return clientResearchFailure(error); }
}
