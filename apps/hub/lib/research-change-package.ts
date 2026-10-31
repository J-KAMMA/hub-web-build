import {normalizeHubOrigin} from './hub-network-client';
import {researchForkDigest,researchForkPackagePath} from './research-fork-package';

export const RESEARCH_CHANGE_BYTES=500_000;
export type ResearchChangePackage={protocol:'hub.research-change.v1';target:{origin:string;projectId:string;documentId:string;baseVersion:number;baseHash:string};body:string;summary:string;contentHash:string};
const invalid=():never=>{throw Error('変更ファイルの対象・版・内容を確認できません。');};
const record=(v:unknown,keys:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))return invalid();return v as Record<string,unknown>;};
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim()&&v.length<=max&&!/[\uD800-\uDFFF]/u.test(v)?v:invalid();
const hash=(v:unknown)=>typeof v==='string'&&v.length===71&&/^sha256:[a-f0-9]{64}$/.test(v)?v:invalid();
/** A transfer file carries a proposed body, not an identity assertion or an author's signature. */
export async function parseResearchChangePackage(input:unknown):Promise<ResearchChangePackage>{
  const p=record(input,['protocol','target','body','summary','contentHash']),t=record(p.target,['origin','projectId','documentId','baseVersion','baseHash']);
  if(p.protocol!=='hub.research-change.v1')return invalid();
  const origin=normalizeHubOrigin(t.origin),projectId=text(t.projectId,35),documentId=text(t.documentId,100);
  researchForkPackagePath(projectId);
  if(origin!==t.origin||/[^A-Za-z0-9_.-]/.test(documentId)||!Number.isSafeInteger(t.baseVersion)||(t.baseVersion as number)<1)return invalid();
  const result:ResearchChangePackage={protocol:'hub.research-change.v1',target:{origin,projectId,documentId,baseVersion:t.baseVersion as number,baseHash:hash(t.baseHash)},body:text(p.body,100000),summary:text(p.summary,500),contentHash:hash(p.contentHash)};
  if(result.summary!==result.summary.trim()||new TextEncoder().encode(JSON.stringify(result)).byteLength>RESEARCH_CHANGE_BYTES||result.contentHash!==await researchForkDigest(result.body))return invalid();
  return result;
}
export async function readResearchChangeFile(file:File){
  if(file.size>RESEARCH_CHANGE_BYTES)throw Error('変更ファイルは500KBまでです。');
  return parseResearchChangePackage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer())));
}
