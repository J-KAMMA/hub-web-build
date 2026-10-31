import { getHubD1 } from '@/lib/server/hub-d1';
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { listSavedUserArticles } from '@/lib/server/d1-user-article-saves';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const after = new URL(request.url).searchParams.get('after') ?? '';
    if (after && !/^[A-Za-z0-9_-]{1,128}$/.test(after)) return Response.json({error:'invalid_cursor'}, {status:400, headers});
    return Response.json(await listSavedUserArticles(database, viewer.id, after), {headers});
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : 503;
    return Response.json({error:status === 401 ? 'desktop_authentication_failed' : status === 403 ? 'suspended' : 'unavailable'}, {status, headers});
  }
}
