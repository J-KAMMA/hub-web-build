import { getHubD1 } from '@/lib/server/hub-d1';
import { requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { createResearchRelation, getResearchProject } from '@/lib/server/d1-research';
import { clientResearchJson, clientResearchFailure, readClientResearchInput } from '@/lib/server/client-research-route';
import { hasSameOrigin } from '@/lib/server/hub-auth-route';
import { ResearchWorkspaceError } from '@/lib/server/research-workspace';

type Context = { params: Promise<{ projectId: string }> };
const id = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && /^[a-z0-9][a-z0-9_-]{2,127}$/u.test(value);
const relationTypes = ['supported_by', 'contradicted_by', 'replicated_by', 'supersedes', 'derived_from', 'uses_protocol', 'included_in', 'reviewed_by'];

export async function POST(request: Request, { params }: Context) {
  if (request.headers.has('origin') && !hasSameOrigin(request)) return clientResearchJson({ error: 'invalid_origin' }, 403);
  try {
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db), { projectId } = await params;
    if (!id(projectId)) throw new ResearchWorkspaceError('プロジェクトの指定が不正です。');
    const project = await getResearchProject(db, projectId, viewer.id);
    if (!project) throw new ResearchWorkspaceError('プロジェクトが見つかりません。', 404);
    if (project.ownerProfileId !== viewer.id) throw new ResearchWorkspaceError('編集権限がありません。', 403);
    const input = await readClientResearchInput(request, 4096);
    if (Object.keys(input).length !== 3 || Object.keys(input).some(key => !['fromObjectId', 'toObjectId', 'relationType'].includes(key))
      || !id(input.fromObjectId) || !id(input.toObjectId) || input.fromObjectId === input.toObjectId
      || typeof input.relationType !== 'string' || !relationTypes.includes(input.relationType)) throw new ResearchWorkspaceError('成果と関係の種類を確認してください。');
    await createResearchRelation(db, project, viewer.id, input);
    return clientResearchJson({ created: true }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_research_relation') return clientResearchJson({ error: '同じプロジェクトにある別の成果を選んでください。' }, 400);
    if (error instanceof Error && error.message === 'research_forbidden') return clientResearchJson({ error: '編集権限がありません。' }, 403);
    return clientResearchFailure(error);
  }
}
