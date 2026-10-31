import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {GIT_IMPORT_MAX_BUNDLE_BYTES,validateGitImportBundleLength} from '@/lib/research-git-import';
import {authorizeResearchGit,researchGitUrl} from './research-git';
import {ResearchWorkspaceError} from './research-workspace';
import { isRedirectResponse } from "@/lib/redirect-guard";

const fail=(message:string,status=503):never=>{throw new ResearchWorkspaceError(message,status);};
/** Anonymous public history only; the caller's credentials never reach the Git service. */
export async function readResearchGitBundle(db:D1Database,projectId:string){
 if(projectId.length!==35||!/^rp_[a-f0-9]{32}$/.test(projectId))return fail('プロジェクトの指定が不正です。',400);
 if(!await authorizeResearchGit(db,projectId,false,''))return fail('公開リポジトリが見つかりません。',404);
 const configured=researchGitUrl(projectId);if(!configured)return fail('Git履歴の取得は現在利用できません。');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},35000);});
 let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  const fetching=fetch(`${new URL(configured).origin}/v1/repositories/${projectId}/bundle`,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/octet-stream','Accept-Encoding':'identity'}});
  void fetching.then(late=>{if(controller.signal.aborted)void late.body?.cancel().catch(()=>{});},()=>{});
  response=await Promise.race([fetching,expired]);
  if(response.status===404)return fail('公開リポジトリが見つかりません。',404);
  if(response.status===413)return fail('全履歴が50MiBを超えています。Gitのclone URLで取得してください。',413);
  if(response.status===409)return fail('まだ履歴がないか、Gitが処理中です。少し待ってから再試行してください。',409);
  const declared=response.headers.get('content-length'),hash=response.headers.get('x-hub-bundle-sha256'),encoding=response.headers.get('content-encoding');
  if(isRedirectResponse(response)||response.status!==200||response.headers.get('content-type')!=='application/octet-stream'||encoding!==null&&encoding.toLowerCase()!=='identity'||!hash||hash.length!==64||!/^[a-f0-9]{64}$/.test(hash))return fail('Git履歴の応答を確認できません。');
  try{if(declared!==null)validateGitImportBundleLength(Number(declared),declared);}
  catch(error){if(error instanceof Error&&error.message==='git_import_bundle_too_large')return fail('Git履歴が50MiBを超えています。',413);return fail('Git履歴の応答を確認できません。');}
  reader=response.body?.getReader();if(!reader)return fail('Git履歴の本文を確認できません。');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await Promise.race([reader.read(),expired]);if(done)break;size+=value.byteLength;if(size>GIT_IMPORT_MAX_BUNDLE_BYTES)return fail('Git履歴が50MiBを超えています。',413);chunks.push(value);}
  try{validateGitImportBundleLength(size,declared??undefined);}catch{return fail('Git履歴の長さを確認できません。');}
  const bytes=new Uint8Array(await Promise.race([new Blob(chunks as BlobPart[]).arrayBuffer(),expired]));
  const actual=Buffer.from(await Promise.race([crypto.subtle.digest('SHA-256',bytes),expired])).toString('hex');
  if(actual!==hash)return fail('Git履歴の本文が応答と一致しません。');
  if(!await Promise.race([authorizeResearchGit(db,projectId,false,''),expired]))return fail('公開リポジトリが見つかりません。',404);
  return {bytes,sha256:actual};
 }catch(error){
  controller.abort();
  if(reader)void reader.cancel().catch(()=>{});else if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});
  if(error instanceof ResearchWorkspaceError)throw error;
  return fail('Git履歴を取得できませんでした。');
 }finally{clearTimeout(timer!);reader?.releaseLock();}
}
