import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalHubSessionProfile} from '@/lib/server/hub-session';
import {readCommunityGovernanceProposal} from '@/lib/server/community-governance-access';
import {governanceJson,governanceFailure,governanceQuery} from '@/lib/server/community-governance-access-route';
export async function GET(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){try{governanceQuery(request);const db=getHubD1(),viewer=await getOptionalHubSessionProfile(request,db),{communityId,proposalId}=await params;return governanceJson(await readCommunityGovernanceProposal(db,communityId,proposalId,viewer?.id??null));}catch(e){return governanceFailure(e);}}

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {requireHubSessionProfile} from '@/lib/server/hub-session';
import {updateCommunityGovernanceLifecycle} from '@/lib/server/community-governance-mutations';
import {readGovernanceInput} from '@/lib/server/community-governance-access-route';
export async function PATCH(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){if (!hasSameOrigin(request)) return governanceJson({error:'invalid_origin'},403);try{governanceQuery(request);const db=getHubD1(),actor=await requireHubSessionProfile(request,db),{communityId,proposalId}=await params,input=await readGovernanceInput(request);return governanceJson(await updateCommunityGovernanceLifecycle(db,actor,communityId,proposalId,input));}catch(error){return governanceFailure(error);}}
