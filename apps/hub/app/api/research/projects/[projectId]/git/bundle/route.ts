import {getHubD1} from '@/lib/server/hub-d1';
import {readResearchGitBundle} from '@/lib/server/research-git-bundle';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string}>}){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{
  if(new URL(request.url).search)throw new ResearchWorkspaceError('Git履歴の指定が不正です。');
  const {projectId}=await params,result=await readResearchGitBundle(getHubD1(),projectId);
  return new Response(result.bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(result.bytes.byteLength),'Content-Disposition':`attachment; filename="${projectId}.bundle"`,'X-Hub-Bundle-SHA256':result.sha256}});
 }catch(error){return Response.json({error:error instanceof ResearchWorkspaceError?error.message:'Git履歴を取得できませんでした。'},{status:error instanceof ResearchWorkspaceError?error.status:503,headers});}
}
