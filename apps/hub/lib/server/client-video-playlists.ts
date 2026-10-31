import 'server-only';
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from './desktop-hub-auth';
import { getHubD1 } from './hub-d1';
import { hasSameOrigin } from './hub-auth-route';
import { HubSuspendedError } from './hub-session';
import {
  addD1VideoPlaylistItem, createD1VideoPlaylist, deleteD1VideoPlaylist, listD1VideoPlaylists,
  removeD1VideoPlaylistItem, updateD1VideoPlaylist, parseVideoPlaylistInput, parseVideoPlaylistUpdate,
  InvalidVideoPlaylistError, VideoPlaylistNotFoundError,
} from './d1-video-library';

type Params = { playlistId?: string; videoId?: string };
type Operation = 'list' | 'create' | 'update' | 'delete' | 'add' | 'remove';
const MAX_BODY = 128 * 1024;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/u.test(value);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
const invalid = (): never => { throw new InvalidVideoPlaylistError('Invalid input.'); };

async function input(request: Request, empty: boolean): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) return empty ? {} : invalid();
  let text = '', size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel().catch(() => {}); return invalid(); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch { await reader.cancel().catch(() => {}); return invalid(); }
  finally { reader.releaseLock(); }
  if (empty && !text) return {};
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return invalid();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return invalid(); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  return body as Record<string, unknown>;
}

/** The fixed route selects the operation; authentication alone supplies the owner. */
export async function clientVideoPlaylists(request: Request, params: Promise<Params>, operation: Operation) {
  try {
    const { playlistId, videoId } = await params;
    if (new URL(request.url).search || !['list', 'create'].includes(operation) && !identifier(playlistId)
      || ['add', 'remove'].includes(operation) && !identifier(videoId)) return json({ error: 'invalid_request' }, 400);
    if (operation !== 'list' && request.headers.has('origin') && !hasSameOrigin(request)) return json({ error: 'invalid_request_origin' }, 403);
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    if (operation === 'list') return json({ viewerId: viewer.id, playlists: await listD1VideoPlaylists(database, viewer.id) });
    const body = await input(request, !['create', 'update'].includes(operation));
    const allowed = ['create', 'update'].includes(operation) ? ['title', 'description'] : [];
    if (Object.keys(body).some(key => !allowed.includes(key))) return invalid();
    if (operation === 'create') return json({ viewerId: viewer.id, playlist: await createD1VideoPlaylist(database, viewer.id, parseVideoPlaylistInput(body)) }, 201);
    if (!identifier(playlistId)) return invalid();
    if (operation === 'update') {
      if (!await updateD1VideoPlaylist(database, viewer.id, playlistId, parseVideoPlaylistUpdate(body))) throw new VideoPlaylistNotFoundError();
      return json({ viewerId: viewer.id, playlistId, updated: true });
    }
    if (operation === 'delete') {
      if (!await deleteD1VideoPlaylist(database, viewer.id, playlistId)) throw new VideoPlaylistNotFoundError();
      return json({ viewerId: viewer.id, playlistId, deleted: true });
    }
    if (!identifier(videoId)) return invalid();
    // Removal's false result means either no membership or no ownership; disambiguate safely.
    const owned = await database.prepare('SELECT id FROM external_video_playlists WHERE id = ? AND owner_profile_id = ?')
      .bind(playlistId, viewer.id).first<{ id: string }>();
    if (!owned) throw new VideoPlaylistNotFoundError();
    if (operation === 'add') {
      if (!await addD1VideoPlaylistItem(database, viewer.id, playlistId, videoId)) throw new VideoPlaylistNotFoundError();
      return json({ viewerId: viewer.id, playlistId, videoId, added: true });
    }
    return json({ viewerId: viewer.id, playlistId, videoId, removed: await removeD1VideoPlaylistItem(database, viewer.id, playlistId, videoId) });
  } catch (error) {
    if (error instanceof InvalidVideoPlaylistError) return json({ error: 'invalid_request' }, 400);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: 'desktop_authentication_failed' }, 401);
    if (error instanceof HubSuspendedError) return json({ error: 'suspended' }, 403);
    if (error instanceof VideoPlaylistNotFoundError) return json({ error: 'not_found' }, 404);
    return json({ error: 'video_playlists_unavailable' }, 503);
  }
}
