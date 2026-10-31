import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {prepareResearchGitDiscussion,createResearchGitDiscussion} from '@/lib/server/research-git-discussion';
import {gitCommitOid} from '@/lib/research-git-browse';
import {clientResearchJson,clientResearchFailure,readClientResearchInput} from '@/lib/server/client-research-route';
type Context={params:Promise<{projectId:string}>};
export async function GET(request:Request,{params}:Context){
  try{
    const query=new URL(request.url).searchParams,oid=query.get('commit');
    if([...query.keys()].some(key=>key!=='commit')||query.getAll('commit').length!==1||!gitCommitOid(oid))return clientResearchJson({error:'完全なコミットIDを一つ指定してください。'},400);
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId}=await params;
    return clientResearchJson(await prepareResearchGitDiscussion(db,projectId,oid,viewer.id));
  }catch(error){return clientResearchFailure(error);}
}
export async function POST(request:Request,{params}:Context){
  try{
    const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId}=await params;
    return clientResearchJson(await createResearchGitDiscussion(db,projectId,viewer,await readClientResearchInput(request,32768)));
  }catch(error){return clientResearchFailure(error);}
}
