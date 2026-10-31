import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile,requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {getCommunityOnboarding,completeCommunityOnboarding} from '@/lib/server/community-onboarding';
import {joinJson,joinFailure,joinQuery,readJoinInput} from '@/lib/server/community-join-route';
type Context={params:Promise<{communityId:string}>};
export async function GET(request:Request,{params}:Context){try{joinQuery(request);const db=getHubD1(),viewer=await getOptionalDesktopHubProfile(request,db),{communityId}=await params;return joinJson(await getCommunityOnboarding(db,communityId,viewer?.id??null));}catch(e){return joinFailure(e);}}
export async function POST(request:Request,{params}:Context){try{joinQuery(request);const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params,input=await readJoinInput(request);if(input instanceof Response)return input;return joinJson(await completeCommunityOnboarding(db,actor,communityId,input));}catch(e){return joinFailure(e);}}
