import { getHubD1, getHubMedia, HubMediaUnavailableError } from '@/lib/server/hub-d1';
import { getOptionalDesktopHubProfile, requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { hasSameOrigin } from '@/lib/server/hub-auth-route';
import { clientResearchJson, clientResearchFailure, readClientResearchInput } from '@/lib/server/client-research-route';
import { ResearchWorkspaceError } from '@/lib/server/research-workspace';
import { researchPdfProject, listResearchPdfs, readPdfBytes, uploadResearchPdf, scanResearchPdf, setResearchPdfVisibility, downloadResearchPdf } from '@/lib/server/research-pdfs';

type Context = { params: Promise<{ projectId: string }> };
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const invalid = (): never => { throw new ResearchWorkspaceError('PDFの操作を確認してください。'); };
function query(request: Request, projectId: string, allowed: string[]) {
  if (projectId.trim() !== projectId || !/^[a-z0-9][a-z0-9_-]{2,127}$/u.test(projectId)) invalid();
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) invalid();
  return params;
}
const failure = (error: unknown) => error instanceof HubMediaUnavailableError ? clientResearchJson({ error: 'PDFの保存先を利用できません。' }, 503) : clientResearchFailure(error);

export async function GET(request: Request, { params }: Context) {
  try {
    const { projectId } = await params, search = query(request, projectId, ['pdf', 'download']);
    if (search.size && (search.size !== 2 || search.get('download') !== '1' || !uuid(search.get('pdf')))) invalid();
    const db = getHubD1(), viewer = await getOptionalDesktopHubProfile(request, db);
    const project = await researchPdfProject(db, projectId, viewer?.id);
    if (search.size) return await downloadResearchPdf(db, getHubMedia(), projectId, search.get('pdf')!, viewer?.id);
    const rows = await listResearchPdfs(db, projectId, viewer?.id);
    const pdfs = rows.map(({ id, title, seriesId, version, visibility, scanStatus, size, sha256, createdAt }) => ({ id, title, seriesId, version, visibility, scanStatus, size, sha256, createdAt }));
    return clientResearchJson({ projectId, pdfs, canEdit: project.ownerProfileId === viewer?.id, signedIn: Boolean(viewer) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: Context) {
  if (request.headers.has('origin') && !hasSameOrigin(request)) return clientResearchJson({ error: 'invalid_origin' }, 403);
  try {
    const { projectId } = await params, search = query(request, projectId, ['action', 'title', 'series']);
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db);
    await researchPdfProject(db, projectId, viewer.id, true);
    const mime = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (search.size) {
      if (search.get('action') !== 'upload' || !search.has('title') || (search.has('series') && !uuid(search.get('series')))) invalid();
      const title = search.get('title')!;
      if (!title.trim() || title.length > 240 || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(title)) invalid();
      if (mime !== 'application/pdf') throw new ResearchWorkspaceError('PDF形式で送信してください。', 415);
      const bytes = await readPdfBytes(request);
      return clientResearchJson(await uploadResearchPdf(db, getHubMedia(), projectId, viewer.id, bytes, title, search.get('series') ?? undefined), 201);
    }
    if (mime !== 'application/json') throw new ResearchWorkspaceError('JSON形式で操作を指定してください。', 415);
    const input = await readClientResearchInput(request, 8192);
    const id = input.id;
    if (!uuid(id)) return invalid();
    if (input.action === 'scan' && Object.keys(input).length === 2) return clientResearchJson({ id, ...await scanResearchPdf(db, getHubMedia(), projectId, id, viewer.id) });
    if (input.action === 'visibility' && Object.keys(input).length === 3 && ['public', 'confidential'].includes(input.visibility as string)) {
      await setResearchPdfVisibility(db, projectId, id, viewer.id, input.visibility);
      return clientResearchJson({ id, visibility: input.visibility });
    }
    return invalid();
  } catch (error) { return failure(error); }
}
