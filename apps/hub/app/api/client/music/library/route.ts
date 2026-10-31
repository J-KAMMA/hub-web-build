import { getHubD1 } from '@/lib/server/hub-d1';
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { musicFavoritePage } from '@/lib/server/client-music-library';
export async function GET(request:Request) {
  const headers={'Cache-Control':'private, no-store'};
  try {
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),url=new URL(request.url),raw=url.searchParams.get('offset') ?? '0';
    if (!/^(0|[1-9][0-9]{0,15})$/.test(raw) || !Number.isSafeInteger(Number(raw))) return Response.json({error:'invalid_offset'},{status:400,headers});
    return Response.json(await musicFavoritePage(db,viewer.id,Number(raw),url.origin),{headers});
  } catch(error) {
    const status=error instanceof DesktopHubAuthenticationError?401:error instanceof HubSuspendedError?403:503;
    return Response.json({error:status===401?'desktop_authentication_failed':status===403?'suspended':'unavailable'},{status,headers});
  }
}
