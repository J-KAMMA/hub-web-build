import { getHubD1 } from '@/lib/server/hub-d1';
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { InvalidSavedVideoCursorError, listD1SavedVideosPage } from '@/lib/server/d1-video-library';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const {savedVideos,nextCursor} = await listD1SavedVideosPage(database, viewer.id, new URL(request.url).searchParams.get('cursor') ?? '');
    return Response.json({savedVideoIds:savedVideos.map(video => video.id), savedVideos,nextCursor}, {headers});
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : error instanceof InvalidSavedVideoCursorError ? 400 : 503;
    return Response.json({error:status === 401 ? 'desktop_authentication_failed' : status === 403 ? 'suspended' : status === 400 ? 'invalid_cursor' : 'unavailable'}, {status, headers});
  }
}
