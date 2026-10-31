import { musicWorkHref } from "@/lib/music-work-href";
import {getHubD1} from '@/lib/server/hub-d1';
import {DesktopHubAuthenticationError,requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {HubSuspendedError} from '@/lib/server/hub-session';
import {readMusicWorksByIds,validMusicKey} from '@/lib/server/client-music-library';
import {contentShareReference} from '@/lib/content-share';
import { DEFAULT_INSTANCE_ORIGIN } from "@/lib/instance-origin";
const headers={'Cache-Control':'private, no-store',Vary:'Authorization'};
export async function GET(request:Request,{params}:{params:Promise<{workId:string}>}) {
  try {
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{workId}=await params;
    if(!validMusicKey(workId)||/[\p{Cc}]/u.test(workId)||new URL(request.url).search)return Response.json({error:'invalid_music_id'},{status:400,headers});
    const configured=process.env.HUB_PUBLIC_ORIGIN??DEFAULT_INSTANCE_ORIGIN,origin=new URL(configured);
    if(origin.origin!==configured||origin.username||origin.password||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))throw Error('origin');
    // This reader resolves active catalogs and the Music service's published/clean metadata only.
    const [work]=await readMusicWorksByIds(db,[workId],origin.origin);
    if(!work||work.id!==workId)return Response.json({error:'not_found'},{status:404,headers});
    const reference=contentShareReference(musicWorkHref(work.id));
    if(!reference)throw Error('reference');
    return Response.json({viewerId:viewer.id,publicAvailable:true,reference},{headers});
  } catch(error) {
    const status=error instanceof DesktopHubAuthenticationError?401:error instanceof HubSuspendedError?403:503;
    return Response.json({error:status===401?'desktop_authentication_failed':status===403?'suspended':'music_share_unavailable'},{status,headers});
  }
}
