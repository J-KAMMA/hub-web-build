import {getHubD1} from '@/lib/server/hub-d1';
import {readResearchGitPatch} from '@/lib/server/research-git-patch';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string}>}){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 try{const q=new URL(request.url).searchParams;if(q.size!==2||q.getAll('base').length!==1||q.getAll('head').length!==1)throw new ResearchWorkspaceError('基準版と変更後の版を一つずつ指定してください。');
  const {projectId}=await params,base=q.get('base')!,head=q.get('head')!,result=await readResearchGitPatch(getHubD1(),projectId,base,head);
  return new Response(result.bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(result.bytes.length),'Content-Disposition':`attachment; filename="${projectId}-${base.slice(0,12)}-${head.slice(0,12)}.patch"`,'X-Hub-Patch-SHA256':result.sha256,'X-Hub-Patch-Base':base,'X-Hub-Patch-Head':head}});
 }catch(error){return Response.json({error:error instanceof ResearchWorkspaceError?error.message:'Gitパッチを取得できませんでした。'},{status:error instanceof ResearchWorkspaceError?error.status:503,headers});}
}
