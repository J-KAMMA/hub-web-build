import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {clientResearchFailure} from '@/lib/server/client-research-route';
import {readResearchGitBundle} from '@/lib/server/research-git-bundle';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string}>}){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{
  if(new URL(request.url).search)throw new ResearchWorkspaceError('Git履歴の指定が不正です。');
  const db=getHubD1();await getOptionalDesktopHubProfile(request,db);
  const {projectId}=await params,result=await readResearchGitBundle(db,projectId);
  return new Response(result.bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(result.bytes.byteLength),'Content-Disposition':`attachment; filename="${projectId}.bundle"`,'X-Hub-Bundle-SHA256':result.sha256}});
 }catch(error){const response=clientResearchFailure(error);for(const [key,value] of Object.entries(headers))response.headers.set(key,value);return response;}
}
