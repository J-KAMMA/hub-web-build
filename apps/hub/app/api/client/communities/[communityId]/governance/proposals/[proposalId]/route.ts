import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readCommunityGovernanceProposal} from '@/lib/server/community-governance-access';
import {governanceJson,governanceFailure,governanceQuery} from '@/lib/server/community-governance-access-route';
export async function GET(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){try{governanceQuery(request);const db=getHubD1(),viewer=await getOptionalDesktopHubProfile(request,db),{communityId,proposalId}=await params;return governanceJson(await readCommunityGovernanceProposal(db,communityId,proposalId,viewer?.id??null));}catch(e){return governanceFailure(e);}}

import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {updateCommunityGovernanceLifecycle} from '@/lib/server/community-governance-mutations';
import {readGovernanceInput} from '@/lib/server/community-governance-access-route';
export async function PATCH(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){try{governanceQuery(request);const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,proposalId}=await params,input=await readGovernanceInput(request);return governanceJson(await updateCommunityGovernanceLifecycle(db,actor,communityId,proposalId,input));}catch(error){return governanceFailure(error);}}
