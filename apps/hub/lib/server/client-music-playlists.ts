import 'server-only';
import { getHubD1 } from './hub-d1';
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from './desktop-hub-auth';
import { HubSuspendedError } from './hub-session';
import { hasSameOrigin } from './hub-auth-route';
import { createD1MusicPlaylist, deleteD1MusicPlaylist, InvalidMusicPlaylistError, isPublicMusicTrackPlaylistKey,
  listD1MusicPlaylists, parseMusicPlaylistInput, parseMusicPlaylistItems, replaceD1MusicPlaylistItems, updateD1MusicPlaylist } from './d1-music-playlists';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/u.test(value);
class InputError extends Error { constructor(readonly status = 400) { super('invalid_request'); } }

export async function readMusicPlaylistInput(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new InputError();
  const buffer = new Uint8Array(128 * 1024);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > buffer.length - length) { await reader.cancel(); throw new InputError(413); }
      buffer.set(value, length); length += value.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError();
    return body as Record<string, unknown>;
  } catch (error) { throw error instanceof InputError ? error : new InputError(); }
  finally { reader.releaseLock(); }
}

type Operation = 'list' | 'create' | 'update' | 'delete' | 'items';
export async function clientMusicPlaylists(request: Request, operation: Operation, playlistId?: string) {
  try {
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    if (new URL(request.url).search || (!['list', 'create'].includes(operation) && !id(playlistId))) throw new InputError();
    if (operation !== 'list' && request.headers.has('origin') && !hasSameOrigin(request)) return json({ error: 'invalid_origin' }, 403);
    if (operation === 'list') return json({ viewerId: viewer.id, playlists: await listD1MusicPlaylists(database, viewer.id) });
    if (operation === 'delete') {
      if (request.body && Object.keys(await readMusicPlaylistInput(request)).length) throw new InputError();
      if (!await deleteD1MusicPlaylist(database, viewer.id, playlistId!)) return json({ error: 'playlist_not_found' }, 404);
      return json({ viewerId: viewer.id, playlistId, deleted: true });
    }
    const body = await readMusicPlaylistInput(request);
    if (operation === 'items') {
      if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'workIds')) throw new InputError();
      const workIds = parseMusicPlaylistItems(body);
      if (workIds.some(value => !id(value) && !isPublicMusicTrackPlaylistKey(value))) throw new InputError();
      if (!await replaceD1MusicPlaylistItems(database, viewer.id, playlistId!, workIds)) return json({ error: 'playlist_not_found' }, 404);
      return json({ viewerId: viewer.id, playlistId, updated: true });
    }
    if (!Object.hasOwn(body, 'title') || Object.keys(body).some(key => key !== 'title' && key !== 'description')) throw new InputError();
    const input = parseMusicPlaylistInput(body);
    if (operation === 'create') return json({ viewerId: viewer.id, playlist: await createD1MusicPlaylist(database, viewer.id, input) }, 201);
    if (!await updateD1MusicPlaylist(database, viewer.id, playlistId!, input)) return json({ error: 'playlist_not_found' }, 404);
    return json({ viewerId: viewer.id, playlistId, updated: true });
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403
      : error instanceof InputError ? error.status : error instanceof InvalidMusicPlaylistError ? 400 : 503;
    return json({ error: status === 401 ? 'desktop_authentication_failed' : status === 403 ? 'suspended'
      : status === 413 ? 'request_too_large' : status === 400 ? 'invalid_request' : 'unavailable' }, status);
  }
}
