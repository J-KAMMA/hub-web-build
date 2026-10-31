import 'server-only';
import { getOptionalDesktopHubProfile, requireDesktopHubProfile, DesktopHubAuthenticationError } from './desktop-hub-auth';
import { getHubD1 } from './hub-d1';
import { hasSameOrigin } from './hub-auth-route';
import { HubSuspendedError } from './hub-session';
import { HubProfileBlockedError } from './profile-blocks';
import { getD1ExternalVideo } from './d1-videos';
import {
  createD1VideoThreadComment, listD1VideoThreadComments, parseVideoThreadCommentInput,
  setD1VideoThreadCommentLike, reportD1VideoThreadComment,
  InvalidVideoThreadCommentError, VideoThreadTargetNotFoundError,
} from './d1-video-thread-comments';

type Params = { videoId: string; commentId?: string };
type Operation = 'list' | 'create' | 'like' | 'unlike' | 'report';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/u.test(value);
const invalid = (): never => { throw new InvalidVideoThreadCommentError('入力を確認してください。'); };

async function input(request: Request, empty = false): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) return empty ? {} : invalid();
  let text = '', size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel().catch(() => {}); return invalid(); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch { await reader.cancel().catch(() => {}); return invalid(); }
  finally { reader.releaseLock(); }
  if (empty && !text) return {};
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalid();
  let value: unknown;
  try { value = JSON.parse(text); } catch { return invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

/** Fixed Desktop routes supply the operation; actors come only from Desktop authentication. */
export async function clientVideoComments(request: Request, params: Promise<Params>, operation: Operation) {
  try {
    const { videoId, commentId } = await params;
    if (!identifier(videoId) || !['list', 'create'].includes(operation) && !identifier(commentId) || new URL(request.url).search) return json({ error: 'invalid_request' }, 400);
    if (operation !== 'list' && request.headers.has('origin') && !hasSameOrigin(request)) return json({ error: 'invalid_request_origin' }, 403);
    const database = getHubD1();
    const viewer = operation === 'list' ? await getOptionalDesktopHubProfile(request, database) : await requireDesktopHubProfile(request, database);
    if (!await getD1ExternalVideo(database, videoId)) throw new VideoThreadTargetNotFoundError();
    if (operation === 'list') return json({ viewerId: viewer?.id ?? null, comments: await listD1VideoThreadComments(database, videoId, viewer?.id) });
    // The required auth branch above returns a profile; keep this explicit for type narrowing.
    if (!viewer) throw new DesktopHubAuthenticationError();
    const body = await input(request, operation === 'like' || operation === 'unlike');
    if (operation === 'create') {
      if (!Object.hasOwn(body, 'body') || Object.keys(body).some(key => !['body', 'parentCommentId'].includes(key))
        || body.parentCommentId !== undefined && body.parentCommentId !== null && !identifier(body.parentCommentId)) return invalid();
      const parsed = parseVideoThreadCommentInput(body);
      return json({ viewerId: viewer.id, comments: await createD1VideoThreadComment(database, { videoId, profileId: viewer.id, ...parsed }) }, 201);
    }
    if (!identifier(commentId)) return invalid();
    if (operation === 'report') {
      if (Object.keys(body).length !== 1 || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 300) return invalid();
      await reportD1VideoThreadComment(database, { videoId, commentId, profileId: viewer.id, reason: body.reason.trim() });
      return json({ viewerId: viewer.id, reported: true, commentId }, 201);
    }
    if (Object.keys(body).length) return invalid();
    return json({ viewerId: viewer.id, comments: await setD1VideoThreadCommentLike(database, { videoId, commentId, profileId: viewer.id, liked: operation === 'like' }) });
  } catch (error) {
    if (error instanceof InvalidVideoThreadCommentError) return json({ error: 'invalid_request' }, 400);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: 'desktop_authentication_failed' }, 401);
    if (error instanceof HubSuspendedError) return json({ error: 'suspended' }, 403);
    if (error instanceof HubProfileBlockedError) return json({ error: 'blocked' }, 403);
    if (error instanceof VideoThreadTargetNotFoundError) return json({ error: 'not_found' }, 404);
    return json({ error: 'video_comments_unavailable' }, 503);
  }
}
