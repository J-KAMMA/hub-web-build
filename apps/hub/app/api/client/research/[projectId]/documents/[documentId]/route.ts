import { getHubD1 } from '@/lib/server/hub-d1';
import { DesktopHubAuthenticationError, getOptionalDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { readResearchDocument, ResearchWorkspaceError } from '@/lib/server/research-workspace';
import { getResearchProject } from '@/lib/server/d1-research';
export async function GET(request: Request, {params}: {params:Promise<{projectId:string;documentId:string}>}) {
  const headers = {'Cache-Control':'no-store'};
  try {
    const db = getHubD1(), viewer = await getOptionalDesktopHubProfile(request,db), {projectId,documentId} = await params;
    const query = new URL(request.url).searchParams;
    if (query.getAll('version').length > 1) throw new ResearchWorkspaceError('版が不正です。');
    const project = await getResearchProject(db, projectId, viewer?.id);
    if (!project) throw new ResearchWorkspaceError('プロジェクトが見つかりません。', 404);
    return Response.json({ ...await readResearchDocument(db,projectId,documentId,viewer?.id,query.has('version') ? Number(query.get('version')) : undefined), canEdit: project.ownerProfileId === viewer?.id, signedIn: Boolean(viewer) },{headers});
  } catch(error) {
    const status = error instanceof ResearchWorkspaceError ? error.status : error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : 503;
    return Response.json({error:'research_unavailable'},{status,headers});
  }
}
