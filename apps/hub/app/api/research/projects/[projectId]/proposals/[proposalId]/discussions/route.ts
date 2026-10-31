import {getHubD1} from '@/lib/server/hub-d1';
import {requireHubSessionProfile,HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {readResearchProposalDiscussions,mutateResearchProposalDiscussions} from '@/lib/server/research-proposal-discussions';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
import {clientResearchJson,clientResearchFailure,readClientResearchInput} from '@/lib/server/client-research-route';
type Context={params:Promise<{projectId:string;proposalId:string}>};
function failure(error:unknown){return clientResearchJson({error:error instanceof ResearchWorkspaceError?error.message:'提案の関連を処理できませんでした。'},error instanceof ResearchWorkspaceError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:503);}
export async function GET(request:Request,{params}:Context){
  try{
    if(new URL(request.url).searchParams.size)return clientResearchJson({error:'指定が不正です。'},400);
    const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId,proposalId}=await params;
    return clientResearchJson(await readResearchProposalDiscussions(db,projectId,proposalId,viewer.id));
  }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){
  if(!hasSameOrigin(request))return clientResearchJson({error:'不正なリクエストです。'},403);
  try{
    if(new URL(request.url).searchParams.size)return clientResearchJson({error:'指定が不正です。'},400);
    const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId,proposalId}=await params;
    return clientResearchJson(await mutateResearchProposalDiscussions(db,projectId,proposalId,viewer.id,await readClientResearchInput(request,32768)));
  }catch(error){return failure(error);}
}
