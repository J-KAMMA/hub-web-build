import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile,requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readCommunityInvite,acceptCommunityInvite} from '@/lib/server/community-invite';
import {inviteJson,inviteFailure,inviteQuery,readInviteInput} from '@/lib/server/community-invite-route';
type Context={params:Promise<{code:string}>};
export async function GET(request:Request,{params}:Context){try{inviteQuery(request);const db=getHubD1(),viewer=await getOptionalDesktopHubProfile(request,db),{code}=await params;return inviteJson(await readCommunityInvite(db,code,viewer?.id??null));}catch(e){return inviteFailure(e);}}
export async function POST(request:Request,{params}:Context){try{inviteQuery(request);const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{code}=await params,input=await readInviteInput(request);if(input instanceof Response)return input;return inviteJson(await acceptCommunityInvite(db,code,actor,input));}catch(e){return inviteFailure(e);}}
