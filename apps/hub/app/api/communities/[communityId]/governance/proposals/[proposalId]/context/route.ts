import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalHubSessionProfile} from '@/lib/server/hub-session';
import {readCommunityGovernanceMutationContext} from '@/lib/server/community-governance-mutations';
import {governanceJson,governanceFailure,governanceQuery} from '@/lib/server/community-governance-access-route';
export async function GET(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){try{governanceQuery(request);const db=getHubD1(),viewer=await getOptionalHubSessionProfile(request,db),{communityId,proposalId}=await params;return governanceJson(await readCommunityGovernanceMutationContext(db,communityId,proposalId,viewer?.id??null));}catch(error){return governanceFailure(error);}}
