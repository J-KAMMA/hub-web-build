import { getHubD1 } from '@/lib/server/hub-d1';
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { getD1ExternalVideo } from '@/lib/server/d1-videos';
import { saveD1ExternalVideo, unsaveD1ExternalVideo } from '@/lib/server/d1-video-library';

const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ videoId: string }> };
async function handle(request: Request, {params}: Context, action: 'read' | 'save' | 'remove') {
  try {
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const {videoId} = await params;
    if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(videoId)) return Response.json({error:'invalid_video'}, {status:400, headers});
    if (action === 'remove') {
      await unsaveD1ExternalVideo(database, viewer.id, videoId);
      return Response.json({saved:false}, {headers});
    }
    if (action === 'save') {
      if (!await saveD1ExternalVideo(database, viewer.id, videoId)) return Response.json({error:'not_found'}, {status:404, headers});
      return Response.json({saved:true}, {headers});
    }
    if (!await getD1ExternalVideo(database, videoId)) return Response.json({error:'not_found'}, {status:404, headers});
    const saved = Boolean(await database.prepare('SELECT video_id FROM external_video_saves WHERE profile_id = ? AND video_id = ? LIMIT 1').bind(viewer.id, videoId).first());
    return Response.json({saved}, {headers});
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : 503;
    return Response.json({error:status === 401 ? 'desktop_authentication_failed' : status === 403 ? 'suspended' : 'unavailable'}, {status, headers});
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, 'read');
export const POST = (request: Request, context: Context) => handle(request, context, 'save');
export const DELETE = (request: Request, context: Context) => handle(request, context, 'remove');
