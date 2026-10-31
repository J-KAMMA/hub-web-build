import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readResearchProposalReview} from '@/lib/server/research-workspace';
import {clientResearchJson,clientResearchFailure} from '@/lib/server/client-research-route';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string;proposalId:string}>}){
  try{
    if(new URL(request.url).searchParams.size)return clientResearchJson({error:'指定が不正です。'},400);
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId,proposalId}=await params;
    return clientResearchJson(await readResearchProposalReview(db,projectId,proposalId,viewer.id));
  }catch(error){return clientResearchFailure(error);}
}
