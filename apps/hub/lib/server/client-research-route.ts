import 'server-only';
import { DesktopHubAuthenticationError } from './desktop-hub-auth';
import { HubD1UnavailableError } from './hub-d1';
import { HubSuspendedError } from './hub-session';
import { ResearchWorkspaceError } from './research-workspace';
import { HubPostRateLimitError } from './d1-rate-limit';

export const clientResearchJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export function clientResearchFailure(error: unknown) {
  if (error instanceof HubPostRateLimitError) return Response.json({ error: error.message }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(error.retryAfterSeconds) } });
  const status = error instanceof ResearchWorkspaceError ? error.status : error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : error instanceof HubD1UnavailableError ? 503 : 500;
  return clientResearchJson({ error: error instanceof ResearchWorkspaceError ? error.message : status === 401 ? 'desktop_authentication_failed' : '研究データを処理できませんでした。' }, status);
}
export async function readClientResearchInput(request: Request, maxBytes = 650000): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ResearchWorkspaceError('入力がありません。');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ResearchWorkspaceError('入力が大きすぎます。', 413); }
    chunks.push(value);
  }
  let input: unknown;
  try { input = JSON.parse(await new Blob(chunks as BlobPart[]).text()); }
  catch { throw new ResearchWorkspaceError('入力が不正です。'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ResearchWorkspaceError('入力が不正です。');
  return input as Record<string, unknown>;
}
