import {normalizeHubOrigin} from './hub-network-client';

export const RESEARCH_GIT_CHANGE_BYTES=8192;
export type ResearchGitChangePackage={protocol:'hub.research-git-change.v1';target:{origin:string;projectId:string};baseOid:string;headOid:string;title:string;summary:string;contentHash:string};
type ResearchGitChangeInput=Omit<ResearchGitChangePackage,'contentHash'>;
const keys=['protocol','target','baseOid','headOid','title','summary'];
const invalid=():never=>{throw Error('Git変更ファイルの対象・版・内容を確認できません。');};
const record=(value:unknown,fields:string[]):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key)))return invalid();
  return value as Record<string,unknown>;
};
const text=(value:unknown,max:number):string=>typeof value==='string'&&value.length<=max&&value.trim()&&value===value.trim()&&!/[\0\uD800-\uDFFF]/u.test(value)?value:invalid();
const project=(value:unknown):string=>typeof value==='string'&&value.length===35&&/^rp_[a-f0-9]{32}$/.test(value)?value:invalid();
const oid=(value:unknown):string=>typeof value==='string'&&(value.length===40||value.length===64)&&/^[a-f0-9]+$/.test(value)?value:invalid();
function contents(input:unknown,fields:string[]):ResearchGitChangeInput {
  const p=record(input,fields),target=record(p.target,['origin','projectId']),origin=normalizeHubOrigin(target.origin);
  if(p.protocol!=='hub.research-git-change.v1'||origin!==target.origin)return invalid();
  const baseOid=oid(p.baseOid),headOid=oid(p.headOid);
  if(baseOid.length!==headOid.length||baseOid===headOid)return invalid();
  return {protocol:'hub.research-git-change.v1',target:{origin,projectId:project(target.projectId)},baseOid,headOid,title:text(p.title,240),summary:text(p.summary,500)};
}
const digest=async(value:ResearchGitChangeInput)=>`sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
function bounded(value:ResearchGitChangePackage):ResearchGitChangePackage {
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>RESEARCH_GIT_CHANGE_BYTES)return invalid();
  return value;
}
/** The digest binds the proposed contents; it does not assert an author or a signature. */
export async function parseResearchGitChangePackage(input:unknown):Promise<ResearchGitChangePackage> {
  const value=contents(input,[...keys,'contentHash']),contentHash=(input as Record<string,unknown>).contentHash;
  if(typeof contentHash!=='string'||contentHash.length!==71||!/^sha256:[a-f0-9]{64}$/.test(contentHash))return invalid();
  const result=bounded({...value,contentHash});
  if(contentHash!==await digest(value))return invalid();
  return result;
}
export async function createResearchGitChangePackage(input:ResearchGitChangeInput):Promise<ResearchGitChangePackage> {
  const value=contents(input,keys);
  bounded({...value,contentHash:`sha256:${'0'.repeat(64)}`});
  return {...value,contentHash:await digest(value)};
}
export async function readResearchGitChangeFile(file:File):Promise<ResearchGitChangePackage> {
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>RESEARCH_GIT_CHANGE_BYTES)throw Error('Git変更ファイルは8KiBまでです。');
  const buffer=await file.arrayBuffer();
  if(buffer.byteLength>RESEARCH_GIT_CHANGE_BYTES)throw Error('Git変更ファイルは8KiBまでです。');
  return parseResearchGitChangePackage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)));
}
export function parseResearchGitChangeTarget(value:string):ResearchGitChangePackage['target'] {
  if(typeof value!=='string'||value!==value.trim()||!/^https?:\/\/[^/?#\\\s]+\/v2\/research\/rp_[a-f0-9]{32}(?:#git)?$/i.test(value))return invalid();
  const url=new URL(value),projectId=project(url.pathname.slice('/v2/research/'.length));
  if(url.username||url.password||url.search||url.pathname!==`/v2/research/${projectId}`||url.hash&&url.hash!=='#git')return invalid();
  return {origin:normalizeHubOrigin(url.origin),projectId};
}
