import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {runGitApplication} from '@/lib/server/research-git-application';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
import {clientResearchJson as json,clientResearchFailure as failure} from '@/lib/server/client-research-route';

async function input(request:Request):Promise<Record<string,unknown>>{
 if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new ResearchWorkspaceError('JSON形式で指定してください。',415);
 const reader=request.body?.getReader();if(!reader)throw new ResearchWorkspaceError('入力がありません。');
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048)throw new ResearchWorkspaceError('入力は2048バイトまでのJSONで指定してください。',413);chunks.push(value);}
 }catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await new Blob(chunks as BlobPart[]).arrayBuffer()));}catch{throw new ResearchWorkspaceError('入力が不正です。');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ResearchWorkspaceError('入力が不正です。');
 return value as Record<string,unknown>;
}

export async function POST(request:Request,{params}:{params:Promise<{projectId:string}>}){
 try{
  if(new URL(request.url).search)throw new ResearchWorkspaceError('指定が不正です。');
  const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId}=await params;
  return json(await runGitApplication(db,projectId,viewer.id,await input(request)));
 }catch(error){return failure(error);}
}
