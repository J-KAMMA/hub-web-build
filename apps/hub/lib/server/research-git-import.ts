import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {GIT_IMPORT_MAX_BUNDLE_BYTES,GIT_IMPORT_MAX_METADATA_BYTES,decodeGitImportMetadataHeader,encodeGitImportMetadataHeader,gitImportProjectId,parseGitImportMetadata,parseGitImportResult,parseGitImportCheckResult,validateGitImportBundleLength} from '@/lib/research-git-import';
import type {GitImportMetadata,GitImportResult,GitImportCheckResult} from '@/lib/research-git-import';
import {researchGitInfo,researchGitUrl,withResearchGitWrite} from './research-git';
import {ResearchWorkspaceError} from './research-workspace';
import { isRedirectResponse } from "@/lib/redirect-guard";

type Operation='preview'|'save'|'check';
const fail=(message:string,status=400):never=>{throw new ResearchWorkspaceError(message,status);};
export function researchGitImportOperation(value:string):Operation{
 if(value!=='preview'&&value!=='save'&&value!=='check')return fail('取込み操作が不正です。');
 return value;
}
async function bytes(source:Request|Response,max:number){
 const declared=source.headers.get('content-length');
 if(declared!==null&&(!/^\d+$(?![\s\S])/.test(declared)||!Number.isSafeInteger(Number(declared))||Number(declared)<1))return fail('本文の長さが不正です。');
 if(declared!==null&&Number(declared)>max)return fail('本文が上限を超えています。',413);
 const reader=source.body?.getReader();if(!reader)return fail('本文がありません。');
 const chunks:Uint8Array[]=[];let size=0;
 const deadline=AbortSignal.timeout(35000);let abort!:()=>void;
 const expired=new Promise<never>((_,reject)=>{abort=()=>reject(new ResearchWorkspaceError('本文を読み込めませんでした。',503));deadline.addEventListener('abort',abort,{once:true});});
 try{
  for(;;){const {done,value}=await Promise.race([reader.read(),expired]);if(done)break;size+=value.byteLength;if(size>max)return fail('本文が上限を超えています。',413);chunks.push(value);}
  if(!size||declared!==null&&Number(declared)!==size)return fail('本文の長さが一致しません。');
  return new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer());
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{deadline.removeEventListener('abort',abort);reader.releaseLock();}
}
async function owner(db:D1Database,projectId:string,viewer:string){
 const current=await researchGitInfo(db,projectId,viewer);
 if(!current.canManage||current.viewerId!==viewer)return fail('取込みは現在の所有者だけが行えます。',403);
 if(!current.repository)return fail('リポジトリがありません。',404);
}
/** Only the configured Git service receives the short-lived internal credential. */
export async function runResearchGitImport(db:D1Database,projectId:string,viewer:string,operation:string,request:Request){
 const mode=researchGitImportOperation(operation);
 if(!gitImportProjectId(projectId)||new URL(request.url).search)return fail('指定が不正です。');
 await owner(db,projectId,viewer);
 const encoding=request.headers.get('content-encoding');if(encoding!==null&&encoding.toLowerCase()!=='identity')return fail('圧縮された本文は受け取れません。',415);
 if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!==(mode==='check'?'application/json':'application/octet-stream'))return fail('本文の形式が不正です。',415);
 let metadata:GitImportMetadata,bundle:Uint8Array|undefined;
 if(mode==='check'){
  if(request.headers.has('x-hub-git-import'))return fail('確認用JSONだけを指定してください。');
  const body=await bytes(request,GIT_IMPORT_MAX_METADATA_BYTES);
  try{metadata=parseGitImportMetadata(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(body)));}catch{return fail('取込み情報が不正です。');}
 }else{
  try{metadata=decodeGitImportMetadataHeader(request.headers.get('x-hub-git-import'));}catch{return fail('取込み情報が不正です。');}
  bundle=await bytes(request,GIT_IMPORT_MAX_BUNDLE_BYTES);
  try{validateGitImportBundleLength(bundle.byteLength,request.headers.get('content-length')??undefined);}catch{return fail('bundleの長さが不正です。');}
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',bundle as Uint8Array<ArrayBuffer>)).toString('hex');
  if(digest!==metadata.bundleSha256)return fail('bundleのハッシュが一致しません。');
 }
 const configured=researchGitUrl(projectId);if(!configured)return fail('Git取込みは現在利用できません。',503);
 let submitted=false;
 try{return await withResearchGitWrite(db,projectId,viewer,async token=>{
  await owner(db,projectId,viewer);
  submitted=true;
  const response=await fetch(`${new URL(configured).origin}/v1/repositories/${projectId}/import/${mode}`,{
   method:'POST',redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(35000),
   headers:{Accept:'application/json',Authorization:'Bearer '+token,'Content-Type':mode==='check'?'application/json':'application/octet-stream',...(mode==='check'?{}:{'X-Hub-Git-Import':encodeGitImportMetadataHeader(metadata)})},
   body:mode==='check'?JSON.stringify(metadata):bundle as Uint8Array<ArrayBuffer>,
  });
  try{
   if(!response.ok||isRedirectResponse(response))return fail(response.status===409?'ブランチや取込み状態が変わりました。':'Git取込みの応答を確認できません。',[401,403,409].includes(response.status)?409:response.status===413?413:503);
   let result:GitImportResult|GitImportCheckResult;
   try{
    if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json'||response.headers.get('content-encoding')&&response.headers.get('content-encoding')?.toLowerCase()!=='identity')throw Error();
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await bytes(response,4096)));
    result=mode==='check'?parseGitImportCheckResult(value,projectId,metadata):parseGitImportResult(value,projectId,metadata,mode);
    if(mode!=='check'&&'bundleBytes' in result&&result.bundleBytes!==bundle?.byteLength)throw Error();
   }catch{return fail('Git取込みの結果を照合できません。',503);}
   await owner(db,projectId,viewer);
   return result;
  }finally{if(response.body&&!response.body.locked)await response.body.cancel().catch(()=>{});}
 });}catch(error){
  if(submitted&&mode==='save')return fail('送信後の取込み結果は不明です。「取込み状態を確認」で結果を確かめてください。',error instanceof ResearchWorkspaceError?error.status:503);
  if(error instanceof ResearchWorkspaceError)throw error;
  return fail(mode==='check'?'Gitの取込み状態を確認できません。':'Gitの取込み候補を確認できません。',503);
 }
}
