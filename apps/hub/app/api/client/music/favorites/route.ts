import { getHubD1 } from '@/lib/server/hub-d1';
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from '@/lib/server/desktop-hub-auth';
import { HubSuspendedError } from '@/lib/server/hub-session';
import { favoriteMusicIds, changeMusicFavorite, validMusicKey } from '@/lib/server/client-music-library';
import { InvalidMusicPlaylistError } from '@/lib/server/d1-music-playlists';
const headers={'Cache-Control':'private, no-store'};
async function handle(request:Request,active?:boolean) {
  try {
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db);
    if (active===undefined) return Response.json({favoriteIds:await favoriteMusicIds(db,viewer.id)},{headers});
    const body=await request.json().catch(()=>null);
    if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1 || !validMusicKey(body.id)
        || (active && body.id.includes(':') && body.id!==body.id.toLowerCase())) return Response.json({error:'invalid_music_id'},{status:400,headers});
    return Response.json(await changeMusicFavorite(db,viewer.id,body.id,active),{headers});
  } catch(error) {
    const status=error instanceof DesktopHubAuthenticationError?401:error instanceof HubSuspendedError?403:error instanceof InvalidMusicPlaylistError?400:503;
    return Response.json({error:status===401?'desktop_authentication_failed':status===403?'suspended':status===400?'invalid_favorite':'unavailable'},{status,headers});
  }
}
export const GET=(request:Request)=>handle(request);
export const POST=(request:Request)=>handle(request,true);
export const DELETE=(request:Request)=>handle(request,false);
