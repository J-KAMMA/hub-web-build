import { RESEARCH_OBJECT_TYPES, RESEARCH_VISIBILITIES, type ResearchObjectType, type ResearchVisibility } from '@/lib/desci-core';
import { getHubD1 } from '@/lib/server/hub-d1';
import { requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { createResearchObject, getResearchProject } from '@/lib/server/d1-research';
import { clientResearchJson, clientResearchFailure, readClientResearchInput } from '@/lib/server/client-research-route';
import { hasSameOrigin } from '@/lib/server/hub-auth-route';
import { ResearchWorkspaceError } from '@/lib/server/research-workspace';

type Context = { params: Promise<{ projectId: string }> };
const clean = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);

export async function POST(request: Request, { params }: Context) {
  if (request.headers.has('origin') && !hasSameOrigin(request)) return clientResearchJson({ error: 'invalid_origin' }, 403);
  try {
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db), { projectId } = await params;
    if (!/^[a-z0-9][a-z0-9_-]{2,127}$/u.test(projectId) || projectId.trim() !== projectId) throw new ResearchWorkspaceError('プロジェクトの指定が不正です。');
    const project = await getResearchProject(db, projectId, viewer.id);
    if (!project) throw new ResearchWorkspaceError('プロジェクトが見つかりません。', 404);
    if (project.ownerProfileId !== viewer.id) throw new ResearchWorkspaceError('編集権限がありません。', 403);
    const input = await readClientResearchInput(request, 8192);
    const keys = ['objectType', 'title', 'version', 'contentHash', 'license', 'visibility'];
    if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))
      || !RESEARCH_OBJECT_TYPES.includes(input.objectType as ResearchObjectType)
      || !RESEARCH_VISIBILITIES.includes(input.visibility as ResearchVisibility)
      || !clean(input.title, 240) || !input.title.trim() || !clean(input.license, 200)
      || typeof input.version !== 'number' || !Number.isSafeInteger(input.version) || input.version < 1
      || typeof input.contentHash !== 'string' || input.contentHash.length !== 71 || !/^sha256:[a-f0-9]{64}$/u.test(input.contentHash)) {
      throw new ResearchWorkspaceError('成果の種類・名前・版・SHA-256・公開範囲を確認してください。');
    }
    return clientResearchJson({ objectId: await createResearchObject(db, project, viewer.id, input) }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('invalid_research_')) return clientResearchJson({ error: '成果の入力を確認してください。' }, 400);
    if (error instanceof Error && error.message === 'research_forbidden') return clientResearchJson({ error: '編集権限がありません。' }, 403);
    return clientResearchFailure(error);
  }
}
