import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {gitBranchName,parseGitApplicationPlan,parseGitApplicationResult} from '@/lib/research-git-application';
import {gitComparisonHash,gitProposalId} from '@/lib/research-git-proposals';
import {gitApplicationState,authorizeGitApplication} from './research-git-proposals';
import {researchGitUrl,withResearchGitWrite} from './research-git';
import {readResearchGitCommit} from './research-git-browse';
import {ResearchWorkspaceError} from './research-workspace';
import { isRedirectResponse } from "@/lib/redirect-guard";
function fail(message:string,status=400):never{throw new ResearchWorkspaceError(message,status);}
export async function runGitApplication(db:D1Database,projectId:string,viewer:string,input:Record<string,unknown>){
 const action=input.action,preview=action==='preview',check=action==='check',fields=preview?['action','proposalId','snapshot']:['action','proposalId','snapshot','comparisonHash','branch',...(check?[]:['confirmed'])];
 if(typeof action!=='string'||!['preview','apply','check'].includes(action)||Object.keys(input).length!==fields.length||Object.keys(input).some(key=>!fields.includes(key))||!gitProposalId(input.proposalId)||typeof input.snapshot!=='string'||input.snapshot.length!==64||!/^[a-f0-9]+$/.test(input.snapshot)||!preview&&(!gitBranchName(input.branch)||typeof input.comparisonHash!=='string'||!check&&input.confirmed!==true))return fail('提案と反映先を確認してください。');
 const identity=await gitApplicationState(db,projectId,viewer,input.proposalId,input.snapshot);
 if(!preview&&input.comparisonHash!==identity.comparisonHash)return fail('承認した差分と一致しません。',409);
 if(!check){const comparison=await readResearchGitCommit(db,projectId,identity.headOid,identity.baseOid);if(await gitComparisonHash(comparison)!==identity.comparisonHash)return fail('承認した差分を現在のGitで確認できません。',409);await gitApplicationState(db,projectId,viewer,input.proposalId,input.snapshot);}
 const configured=researchGitUrl(projectId);if(!configured)return fail('Git反映は現在利用できません。',503);
 const review=[identity.proposalId,identity.snapshot,identity.baseOid,identity.headOid].join(':'),branch=input.branch as string;
 return withResearchGitWrite(db,projectId,viewer,async token=>{
  if(!await authorizeGitApplication(db,projectId,review))return fail('提案や権限が変わりました。',409);
  let response:Response;
  try{response=await fetch(`${new URL(configured).origin}/v1/repositories/${projectId}/${preview?'branches':check?'check':'apply'}`,{method:preview?'GET':'POST',redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(35000),headers:{Accept:'application/json',Authorization:'Bearer '+token,'X-Hub-Git-Review':review,...(preview?{}:{'Content-Type':'application/json'})},...(preview?{}:{body:JSON.stringify({branch,baseOid:identity.baseOid,headOid:identity.headOid})})});}catch{return fail('Gitの応答を確認できません。送信後は反映状態を確認してください。',503);}
  if(!response.ok||isRedirectResponse(response)){await response.body?.cancel().catch(()=>{});return fail(response.status===409?'ブランチや権限が変わりました。反映状態を確認してください。':response.status===401?'反映権限を確認できません。送信後は結果不明です。':'Gitの結果を確認できません。送信後は反映状態を確認してください。',[401,409].includes(response.status)?409:503);}
  try{
   if(!response.headers.get('content-type')?.startsWith('application/json'))throw Error();const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>65536))throw Error();
   const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error();}chunks.push(value);}}finally{reader.releaseLock();}
   if(declared&&Number(declared)!==size)throw Error();const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await new Blob(chunks as BlobPart[]).arrayBuffer()));
   if(!value||value.projectId!==projectId)throw Error();const result=preview?parseGitApplicationPlan({...value,...identity},projectId,identity.proposalId):parseGitApplicationResult({...identity,...value},identity,branch,check);
   await gitApplicationState(db,projectId,viewer,identity.proposalId,identity.snapshot);return result;
  }catch(error){await response.body?.cancel().catch(()=>{});if(error instanceof ResearchWorkspaceError)throw error;return fail('Gitの結果を照合できません。送信後は反映状態を確認してください。',503);}
 });
}
