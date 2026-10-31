import { getHubD1 } from '@/lib/server/hub-d1';
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { readMusicWorksByIds, validMusicKey } from '@/lib/server/client-music-library';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
type Context = { params: Promise<{ workId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db);
    const { workId } = await params, url = new URL(request.url);
    if (!validMusicKey(workId) || /[\u0000-\u001f\u007f-\u009f]/u.test(workId) || url.search) return Response.json({ error: 'invalid_music_id' }, { status: 400, headers });
    const [work] = await readMusicWorksByIds(db, [workId], url.origin);
    return work ? Response.json({ viewerId: viewer.id, work }, { headers }) : Response.json({ error: 'not_found' }, { status: 404, headers });
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : 503;
    return Response.json({ error: status === 401 ? 'desktop_authentication_failed' : status === 403 ? 'suspended' : 'music_work_unavailable' }, { status, headers });
  }
}
