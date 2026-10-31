import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {getHubD1} from '@/lib/server/hub-d1';
import {requireHubSessionProfile} from '@/lib/server/hub-session';
import {governanceJson,governanceFailure,governanceQuery,readGovernanceInput} from '@/lib/server/community-governance-access-route';
import {castCommunityGovernanceVote} from '@/lib/server/community-governance-mutations';
export async function POST(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){if (!hasSameOrigin(request)) return governanceJson({error:'invalid_origin'},403);try{governanceQuery(request);const db=getHubD1(),actor=await requireHubSessionProfile(request,db),{communityId,proposalId}=await params,input=await readGovernanceInput(request);return governanceJson(await castCommunityGovernanceVote(db,actor,communityId,proposalId,input));}catch(error){return governanceFailure(error);}}
