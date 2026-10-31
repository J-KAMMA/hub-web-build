import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalHubSessionProfile} from '@/lib/server/hub-session';
import {readCommunityGovernanceCreateContext} from '@/lib/server/community-governance-create';
import {governanceJson,governanceFailure,governanceQuery} from '@/lib/server/community-governance-access-route';
export async function GET(request:Request,{params}:{params:Promise<{communityId:string}>}){try{governanceQuery(request);const db=getHubD1(),viewer=await getOptionalHubSessionProfile(request,db),{communityId}=await params;return governanceJson(await readCommunityGovernanceCreateContext(db,communityId,viewer?.id??null));}catch(e){return governanceFailure(e);}}
