import {getHubD1} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {requireHubSessionProfile,HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {researchGitImportOperation,runResearchGitImport} from '@/lib/server/research-git-import';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;operation:string}>}){
 if(!hasSameOrigin(request))return json({error:'不正なリクエストです。'},403);
 try{
  if(new URL(request.url).search)throw new ResearchWorkspaceError('指定が不正です。');
  const {projectId,operation}=await params;researchGitImportOperation(operation);
  const db=getHubD1(),viewer=await requireHubSessionProfile(request,db);
  return json(await runResearchGitImport(db,projectId,viewer.id,operation,request));
 }catch(error){return json({error:error instanceof ResearchWorkspaceError?error.message:error instanceof HubAuthenticationError?'ログインしてください。':'Gitの取込み結果を確認できません。'},error instanceof ResearchWorkspaceError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:503);}
}
