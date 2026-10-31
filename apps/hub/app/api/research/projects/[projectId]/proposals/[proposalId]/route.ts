import {getHubD1} from '@/lib/server/hub-d1';
import {requireHubSessionProfile,HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {readResearchProposalReview,ResearchWorkspaceError} from '@/lib/server/research-workspace';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;proposalId:string}>}){
  try{
    if(new URL(request.url).searchParams.size)return Response.json({error:'指定が不正です。'},{status:400,headers});
    const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId,proposalId}=await params;
    return Response.json(await readResearchProposalReview(db,projectId,proposalId,viewer.id),{headers});
  }catch(error){return Response.json({error:error instanceof ResearchWorkspaceError?error.message:'変更提案を読み込めませんでした。'},{status:error instanceof ResearchWorkspaceError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:503,headers});}
}
