import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readCommunityAccessManagement,mutateCommunityAccessManagement,CommunityAccessManagementError} from '@/lib/server/community-access-management';
import {accessManagementJson,accessManagementFailure,accessManagementQuery,readAccessManagementInput} from '@/lib/server/community-access-management-route';
type Context={params:Promise<{communityId:string}>};
export async function GET(request:Request,{params}:Context){try{const {kind,offset}=accessManagementQuery(new URL(request.url).searchParams),db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params;return accessManagementJson(await readCommunityAccessManagement(db,actor.id,communityId,kind,offset));}catch(error){return accessManagementFailure(error);}}
export async function POST(request:Request,{params}:Context){try{if(new URL(request.url).searchParams.size)throw new CommunityAccessManagementError('指定が不正です。',400);const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params,input=await readAccessManagementInput(request);if(input instanceof Response)return input;return accessManagementJson(await mutateCommunityAccessManagement(db,actor.id,communityId,input));}catch(error){return accessManagementFailure(error);}}
