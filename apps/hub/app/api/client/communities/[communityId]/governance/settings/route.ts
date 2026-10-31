import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile,requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {readCommunityGovernanceSettings,updateCommunityGovernanceSettings} from '@/lib/server/community-governance-access';
import {governanceJson,governanceFailure,governanceQuery,readGovernanceInput} from '@/lib/server/community-governance-access-route';
type Context={params:Promise<{communityId:string}>};
export async function GET(request:Request,{params}:Context){try{governanceQuery(request);const db=getHubD1(),viewer=await getOptionalDesktopHubProfile(request,db),{communityId}=await params;return governanceJson(await readCommunityGovernanceSettings(db,communityId,viewer?.id??null));}catch(e){return governanceFailure(e);}}
export async function PATCH(request:Request,{params}:Context){try{governanceQuery(request);const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params,input=await readGovernanceInput(request);return governanceJson(await updateCommunityGovernanceSettings(db,actor,communityId,input));}catch(e){return governanceFailure(e);}}
