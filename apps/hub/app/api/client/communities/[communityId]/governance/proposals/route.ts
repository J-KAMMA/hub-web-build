import {createCommunityGovernanceProposal} from '@/lib/server/community-governance-create';
import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile,requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readCommunityGovernancePage} from '@/lib/server/community-governance-access';
import {governanceJson,governanceFailure,governanceQuery,readGovernanceInput} from '@/lib/server/community-governance-access-route';
export async function GET(request:Request,{params}:{params:Promise<{communityId:string}>}){try{const offset=governanceQuery(request,true)??0,db=getHubD1(),viewer=await getOptionalDesktopHubProfile(request,db),{communityId}=await params;return governanceJson(await readCommunityGovernancePage(db,communityId,viewer?.id??null,offset));}catch(e){return governanceFailure(e);}}

export async function POST(request:Request,{params}:{params:Promise<{communityId:string}>}){try{governanceQuery(request);const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params,input=await readGovernanceInput(request);return governanceJson(await createCommunityGovernanceProposal(db,actor,communityId,input),201);}catch(e){return governanceFailure(e);}}
