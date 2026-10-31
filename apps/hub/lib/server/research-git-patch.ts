import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {gitCommitOid} from '@/lib/research-git-browse';
import {authorizeResearchGit,researchGitUrl} from './research-git';
import {ResearchWorkspaceError} from './research-workspace';
import { isRedirectResponse } from "@/lib/redirect-guard";
export const MAX_RESEARCH_GIT_PATCH=16*1024*1024;
function fail(message:string,status=503):never{throw new ResearchWorkspaceError(message,status);}
export async function readResearchGitPatch(db:D1Database,projectId:string,baseOid:string,headOid:string){
 if(projectId.length!==35||!/^rp_[a-f0-9]{32}$/.test(projectId)||!gitCommitOid(baseOid)||!gitCommitOid(headOid)||baseOid.length!==headOid.length)fail('比較する版の指定が不正です。',400);
 if(!await authorizeResearchGit(db,projectId,false,''))fail('公開リポジトリが見つかりません。',404);
 const configured=researchGitUrl(projectId);if(!configured)fail('Gitパッチの取得は現在利用できません。');
 let response:Response|undefined;
 try{
  response=await fetch(`${new URL(configured).origin}/v1/repositories/${projectId}/patch/${baseOid}/${headOid}`,{redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Accept:'application/octet-stream'}});
  if(response.status===404)fail('公開された二版が見つかりません。',404);
  if(response.status===413)fail('変更パッチが16MiBを超えています。Gitで二版を取得してください。',413);
  if(response.status===409)fail('変更がないか、Gitが処理中です。二版を確認し、少し待ってから再試行してください。',409);
  const declared=response.headers.get('content-length'),hash=response.headers.get('x-hub-patch-sha256');
  if(!response.ok||isRedirectResponse(response)||response.headers.get('content-type')!=='application/octet-stream'||response.headers.get('x-hub-patch-base')!==baseOid||response.headers.get('x-hub-patch-head')!==headOid||!hash||!/^[a-f0-9]{64}$(?![\s\S])/.test(hash)||declared!==null&&(!/^\d+$/.test(declared)||Number(declared)<1||Number(declared)>MAX_RESEARCH_GIT_PATCH))fail('Gitパッチの応答を確認できません。');
  const reader=response.body?.getReader();if(!reader)fail('Gitパッチの本文を確認できません。');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESEARCH_GIT_PATCH){await reader.cancel();fail('Gitパッチの応答を確認できません。');}chunks.push(value);}}finally{reader.releaseLock();}
  if(!size||declared!==null&&Number(declared)!==size)fail('Gitパッチの応答を確認できません。');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');if(actual!==hash)fail('Gitパッチの本文が応答と一致しません。');
  if(!await authorizeResearchGit(db,projectId,false,''))fail('公開リポジトリが見つかりません。',404);
  return {bytes,sha256:hash};
 }catch(error){if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});if(error instanceof ResearchWorkspaceError)throw error;fail('Gitパッチを取得できませんでした。');}
}
