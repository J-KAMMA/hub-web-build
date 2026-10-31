import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readResearchProposalDiscussions,mutateResearchProposalDiscussions} from '@/lib/server/research-proposal-discussions';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
import {clientResearchJson,clientResearchFailure,readClientResearchInput} from '@/lib/server/client-research-route';
type Context={params:Promise<{projectId:string;proposalId:string}>};
const failure=clientResearchFailure;
export async function GET(request:Request,{params}:Context){
  try{
    if(new URL(request.url).searchParams.size)return clientResearchJson({error:'指定が不正です。'},400);
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId,proposalId}=await params;
    return clientResearchJson(await readResearchProposalDiscussions(db,projectId,proposalId,viewer.id));
  }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){

  try{
    if(new URL(request.url).searchParams.size)return clientResearchJson({error:'指定が不正です。'},400);
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId,proposalId}=await params;
    return clientResearchJson(await mutateResearchProposalDiscussions(db,projectId,proposalId,viewer.id,await readClientResearchInput(request,32768)));
  }catch(error){return failure(error);}
}
