import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {readResearchGitHistory,readResearchGitCommit} from '@/lib/server/research-git-browse';
import {gitCommitOid} from '@/lib/research-git-browse';
import {clientResearchJson,clientResearchFailure} from '@/lib/server/client-research-route';
type Context={params:Promise<{projectId:string}>};
export async function GET(request:Request,{params}:Context){
  try{
    const query=new URL(request.url).searchParams,oid=query.get('commit'),base=query.get('base');
    if([...query.keys()].some(key=>!['commit','base'].includes(key))||query.getAll('commit').length>1||query.getAll('base').length>1||(oid!==null&&!gitCommitOid(oid))||(base!==null&&(!oid||!gitCommitOid(base)||base.length!==oid.length)))return clientResearchJson({error:'同じ形式の完全なコミットIDを指定してください。'},400);
    const db=getHubD1();await getOptionalDesktopHubProfile(request,db);
    const {projectId}=await params;
    return clientResearchJson(oid===null?await readResearchGitHistory(db,projectId):base===null?await readResearchGitCommit(db,projectId,oid):await readResearchGitCommit(db,projectId,oid,base));
  }catch(error){return clientResearchFailure(error);}
}
