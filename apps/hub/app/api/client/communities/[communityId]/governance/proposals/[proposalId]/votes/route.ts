import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {governanceJson,governanceFailure,governanceQuery,readGovernanceInput} from '@/lib/server/community-governance-access-route';
import {castCommunityGovernanceVote} from '@/lib/server/community-governance-mutations';
export async function POST(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){try{governanceQuery(request);const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,proposalId}=await params,input=await readGovernanceInput(request);return governanceJson(await castCommunityGovernanceVote(db,actor,communityId,proposalId,input));}catch(error){return governanceFailure(error);}}
