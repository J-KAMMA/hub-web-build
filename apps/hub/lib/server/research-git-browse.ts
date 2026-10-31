import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {gitCommitOid,parseResearchGitHistory,parseResearchGitCommitDetail} from '@/lib/research-git-browse';
import {authorizeResearchGit,researchGitUrl} from './research-git';
import {ResearchWorkspaceError} from './research-workspace';
import { isRedirectResponse } from "@/lib/redirect-guard";
const MAX_BYTES=512*1024;
async function read(db:D1Database,projectId:string,oid?:string,baseOid?:string) {
  if(projectId.length!==35||!/^rp_[a-f0-9]{32}$/.test(projectId)||(oid!==undefined&&!gitCommitOid(oid)))throw new ResearchWorkspaceError('指定が不正です。');
  if(baseOid!==undefined&&(!gitCommitOid(baseOid)||!oid||baseOid.length!==oid.length))throw new ResearchWorkspaceError('比較するコミットIDの指定が不正です。');
  if(!await authorizeResearchGit(db,projectId,false,''))throw new ResearchWorkspaceError('公開リポジトリが見つかりません。',404);
  const configured=researchGitUrl(projectId);if(!configured)throw new ResearchWorkspaceError('Git閲覧は現在利用できません。',503);
  try {
    const origin=new URL(configured).origin;
    const response=await fetch(`${origin}/v1/repositories/${projectId}/${baseOid?`compare/${baseOid}/${oid}`:`commits${oid?`/${oid}`:''}`}`,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
    if(response.status===404)throw new ResearchWorkspaceError('公開された変更が見つかりません。',404);
    if(!response.ok||isRedirectResponse(response))throw Error('git_unavailable');
    const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))throw Error('git_oversize');
    const reader=response.body?.getReader();if(!reader)throw Error('git_empty');
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('git_oversize');}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const result=oid?parseResearchGitCommitDetail(value,projectId,oid,baseOid):parseResearchGitHistory(value,projectId);
    if(!await authorizeResearchGit(db,projectId,false,''))throw new ResearchWorkspaceError('公開リポジトリが見つかりません。',404);
    return result;
  }catch(error){if(error instanceof ResearchWorkspaceError)throw error;throw new ResearchWorkspaceError('Git履歴を読み込めませんでした。',503);}
}
export async function readResearchGitHistory(db:D1Database,projectId:string){return await read(db,projectId) as import('@/lib/research-git-browse').ResearchGitHistory;}
export async function readResearchGitCommit(db:D1Database,projectId:string,oid:string,baseOid?:string){return await read(db,projectId,oid,baseOid) as import('@/lib/research-git-browse').ResearchGitCommitDetail;}
