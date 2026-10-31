import { getHubD1, HubD1UnavailableError } from '@/lib/server/hub-d1';
import { hasSameOrigin } from '@/lib/server/hub-auth-route';
import { getOptionalHubSessionProfile, requireHubSessionProfile, HubAuthenticationError, HubSuspendedError } from '@/lib/server/hub-session';
import { mutateResearchWorkspace, readResearchWorkspace, readResearchDocument, ResearchWorkspaceError } from '@/lib/server/research-workspace';
import { searchResearchLinks } from '@/lib/server/research-link-search';
import { prepareResearchDiscussion, createResearchDiscussion } from '@/lib/server/research-discussion';
import { HubPostRateLimitError } from '@/lib/server/d1-rate-limit';

type Context = { params: Promise<{ projectId: string }> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error: unknown) {
  if (error instanceof HubPostRateLimitError) return Response.json({ error: error.message }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(error.retryAfterSeconds) } });
  const status = error instanceof ResearchWorkspaceError ? error.status : error instanceof HubSuspendedError ? 403 : error instanceof HubAuthenticationError ? 401 : error instanceof HubD1UnavailableError ? 503 : 500;
  return json({ error: error instanceof ResearchWorkspaceError ? error.message : status === 401 ? 'ログインしてください。' : '研究データを処理できませんでした。' }, status);
}
export async function GET(request: Request, { params }: Context) {
  try {
    const db = getHubD1(), viewer = await getOptionalHubSessionProfile(request, db), { projectId } = await params;
    const query = new URL(request.url).searchParams, document = query.get('document');
    if (query.has('discussion')) {
      if (document || query.has('linkKind') || query.getAll('discussion').length !== 1 || query.getAll('version').length !== 1 || !/^[1-9][0-9]*$/.test(query.get('version')!)) return json({ error: '参照する文書と版を指定してください。' }, 400);
      return json(await prepareResearchDiscussion(db, projectId, query.get('discussion')!, Number(query.get('version')), viewer?.id));
    }
    if (query.has('linkKind')) {
      if (document || query.getAll('linkKind').length !== 1 || query.getAll('q').length > 1) return json({ error: '検索条件が不正です。' }, 400);
      return json(await searchResearchLinks(db, projectId, viewer?.id, query.get('linkKind')!, query.get('q') ?? ''));
    }
    if (document && (query.getAll('document').length !== 1 || (query.has('version') && (query.getAll('version').length !== 1 || !/^[1-9][0-9]*$/.test(query.get('version')!))))) return json({ error: '参照する版が不正です。' }, 400);
    return json(document ? await readResearchDocument(db, projectId, document, viewer?.id, query.has('version') ? Number(query.get('version')) : undefined) : await readResearchWorkspace(db, projectId, viewer?.id));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return json({ error: '不正なリクエストです。' }, 403);
  try {
    const db = getHubD1(), viewer = await requireHubSessionProfile(request, db), { projectId } = await params;
    const reader = request.body?.getReader();
    if (!reader) return json({ error: '入力がありません。' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 650000) { await reader.cancel(); return json({ error: '入力が大きすぎます。' }, 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(await new Blob(chunks as BlobPart[]).text()); } catch { return json({ error: '入力が不正です。' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '入力が不正です。' }, 400);
    const input = body as Record<string, unknown>;
    return json(input.action === 'discuss' ? await createResearchDiscussion(db, projectId, viewer, input) : await mutateResearchWorkspace(db, projectId, viewer.id, input, new URL(request.url).origin));
  } catch (error) { return failure(error); }
}
