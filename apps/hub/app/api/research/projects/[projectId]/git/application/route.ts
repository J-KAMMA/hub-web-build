import {getHubD1} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {requireHubSessionProfile,HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {readPdfBytes} from '@/lib/server/research-pdfs';
import {runGitApplication} from '@/lib/server/research-git-application';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 if(!hasSameOrigin(request))return json({error:'不正なリクエストです。'},403);
 if(new URL(request.url).search)return json({error:'指定が不正です。'},400);
 try{
  const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId}=await params;
  let input:unknown,bytes:Uint8Array;try{bytes=await readPdfBytes(request,2048);}catch(error){if(error instanceof ResearchWorkspaceError)return json({error:'入力は2048バイトまでのJSONで指定してください。'},error.status);throw error;}try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({error:'入力が不正です。'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'入力が不正です。'},400);
  return json(await runGitApplication(db,projectId,viewer.id,input as Record<string,unknown>));
 }catch(error){return json({error:error instanceof ResearchWorkspaceError?error.message:error instanceof HubAuthenticationError?'ログインしてください。':'Gitの反映結果を確認できません。'},error instanceof ResearchWorkspaceError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:503);}
}
