'use client';

import React,{useEffect,useState,type FormEvent} from 'react';
import {UiButton,UiField,UiInput,UiTextarea} from '@/components/ui/primitives';
import type {ResearchProposalCreated} from '@/lib/research-workspace';
import {readResearchChangeFile,RESEARCH_CHANGE_BYTES} from '@/lib/research-change-package';
import {P2PTransferPanel} from './p2p-transfer-panel';
import {PAIRING_RELAY_ORIGIN} from '@/lib/p2p-pairing.mjs';

type Draft={body:string;summary:string;baseVersion:number;expectedBaseHash?:string};
type Review=Draft & {requestId:string;contentHash:string};
type Entry={draft:Draft;review?:Review;result?:ResearchProposalCreated;busy?:boolean;uncertain?:boolean;error?:string;open?:boolean;sync?:()=>void};
export type ResearchProposalCreateMemory=Map<string,Entry>;
type Props={projectId:string;documentId:string;version:number;head:number;body:string;memory:ResearchProposalCreateMemory;openProposal:(id:string)=>void;reloadDocument?:()=>void;onAccessLost?:()=>void};
export const researchProposalCreateKey=(projectId:string,documentId:string)=>JSON.stringify([projectId,documentId]);
const text=(value:string,max:number)=>value.trim().length>0&&value.length<=max&&!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
const safeVersion=(value:number)=>Number.isSafeInteger(value)&&value>0;
const digest=async(body:string)=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),value=>value.toString(16).padStart(2,'0')).join('');

export function ResearchProposalCreate({projectId,documentId,version,head,body,memory,openProposal,reloadDocument,onAccessLost}:Props){
  const key=researchProposalCreateKey(projectId,documentId),[entry]=useState(()=>{const saved=memory.get(key)??{draft:{body,summary:'',baseVersion:version}};memory.set(key,saved);return saved;}),[,refresh]=useState(0);
  const [peer,setPeer]=useState(false);
  const valid=()=>memory.get(key)===entry,sync=()=>entry.sync?.();
  useEffect(()=>{const invitation=()=>{if(location.hash.startsWith('#pair=')){setPeer(true);entry.open=true;sync();}};invitation();window.addEventListener('hashchange',invitation);return()=>window.removeEventListener('hashchange',invitation);},[entry]);
  useEffect(()=>{const update=()=>refresh(value=>value+1);entry.sync=update;/* An edit or preview that ran between commit and this passive effect called a still-unset sync and was never rendered; catch up once. */update();return()=>{if(entry.sync===update)delete entry.sync;};},[entry]);
  function edit(change:Partial<Draft>){if(!valid()||entry.busy||entry.review||entry.result)return;entry.draft={...entry.draft,...change,...(change.baseVersion!==undefined?{expectedBaseHash:undefined}:{})};entry.open=true;entry.error='';sync();}
  async function importChange(file?:File){
    if(!file||!valid()||entry.busy||entry.review||entry.result)return;entry.busy=true;entry.error='';sync();
    try{const value=await readResearchChangeFile(file),target=value.target;
      if(target.origin!==window.location.origin||target.projectId!==projectId||target.documentId!==documentId||target.baseVersion!==version||target.baseVersion!==head||target.baseHash!==await digest(body))throw Error('原本のHub・文書・最新版がファイルの基準と一致しません。原本を確認してください。');
      if(valid()){entry.draft={body:value.body,summary:value.summary,baseVersion:target.baseVersion,expectedBaseHash:target.baseHash};entry.open=true;}
    }catch(e){if(valid())entry.error=e instanceof Error?e.message:'変更ファイルを読めません。';}finally{if(valid()){entry.busy=false;sync();}}
  }
  async function preview(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!valid()||entry.busy||entry.review||entry.result)return;
    const draft={...entry.draft,summary:entry.draft.summary.trim()};
    if(!safeVersion(draft.baseVersion)||draft.baseVersion!==head||!text(draft.body,100000)||!text(draft.summary,500)){entry.error='最新版を基準に、本文と変更の理由を確認してください。';sync();return;}
    entry.busy=true;entry.error='';sync();
    try{const contentHash=await digest(draft.body);if(valid()){entry.review=Object.freeze({...draft,requestId:crypto.randomUUID(),contentHash});entry.open=true;}}
    catch{if(valid())entry.error='確認情報を作成できませんでした。安全な接続で開き直してください。';}
    finally{if(valid()){entry.busy=false;sync();}}
  }
  async function save(){
    const review=entry.review;if(!valid()||!review||entry.busy||entry.result)return;
    if(!entry.uncertain&&review.baseVersion!==head){delete entry.review;entry.error='最新版を確認してから、提案の基準を更新してください。';sync();return;}
    const uncertain=entry.uncertain===true;entry.busy=true;entry.error='';sync();
    try{
      const response=await fetch(`/api/research/projects/${encodeURIComponent(projectId)}/workspace`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({action:'propose',requestId:review.requestId,documentId,baseVersion:review.baseVersion,body:review.body,summary:review.summary,...(review.expectedBaseHash?{expectedBaseHash:review.expectedBaseHash}:{})})});
      if(!valid())return;
      if(!response.ok){
        const refused=[400,401,403,404,409,429].includes(response.status);
        if(refused&&!uncertain){delete entry.review;entry.uncertain=false;}else entry.uncertain=true;
        if([401,403,404].includes(response.status)){onAccessLost?.();if(!valid())return;}
        const value=await response.json();throw new Error(typeof value.error==='string'?value.error:'保存を確認できませんでした。');
      }
      const result=await response.json();if(!valid())return;
      if(result.proposalId!==review.requestId||result.documentId!==documentId||result.baseVersion!==review.baseVersion||result.contentHash!==review.contentHash||!['open','accepted','rejected'].includes(result.status))throw new Error('保存結果を確認できません。同じ内容で再試行してください。');
      entry.result={proposalId:review.requestId,documentId,baseVersion:review.baseVersion,contentHash:review.contentHash,status:result.status};delete entry.review;entry.uncertain=false;
    }catch(error){if(valid()){if(entry.review)entry.uncertain=true;entry.error=error instanceof Error?error.message:'保存結果を確認できません。同じ内容で再試行してください。';}}
    finally{if(valid()){entry.busy=false;sync();}}
  }
  if(!valid())return <p role="status">接続が変わりました。文書を選び直してください。</p>;
  return <details className="research-proposal-create" open={!!entry.open||!!entry.review||!!entry.result||!!entry.error} onToggle={event=>{if(valid())entry.open=event.currentTarget.open;}}>
    <summary>変更を提案する</summary>
    <p>基準 v{entry.draft.baseVersion} · 未採用の本文と理由は、提案者と所有者だけが確認できます。</p>
    {entry.error?<p role="alert">{entry.error}</p>:null}
    {entry.error&&reloadDocument?<UiButton type="button" disabled={entry.busy} onClick={reloadDocument}>文書を再読み込み</UiButton>:null}
    {!entry.review&&!entry.result?<form onSubmit={preview}>
      <label>別Hubから持ち出した変更（JSON）<input type="file" accept="application/json,.json" disabled={entry.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void importChange(file);}}/></label>
      <UiButton type="button" disabled={entry.busy} onClick={()=>setPeer(value=>!value)}>{peer?'端末からの受信を閉じる':'端末から変更を受け取る'}</UiButton>
      {peer?<P2PTransferPanel embedded allowRelaySelection pairOrigin={PAIRING_RELAY_ORIGIN} onReceiveFile={importChange} maxFileBytes={RESEARCH_CHANGE_BYTES}/>:null}
      <p>読み込みだけでは保存しません。このHubの自分のプロフィールで提案し、原本側の所有者が採否を決めます。ファイルは送付者や出自の証明ではありません。</p>
      {entry.draft.baseVersion!==head?<><p>最新版は v{head} です。本文を確認してから基準を更新してください。下書きは保持しています。</p><UiButton type="button" disabled={entry.busy||version!==head||!safeVersion(head)} onClick={()=>edit({baseVersion:head})}>最新版を基準に編集を続ける</UiButton></>:null}
      <UiField label="変更内容"><UiTextarea name="body" aria-label="変更内容" required maxLength={100000} rows={12} value={entry.draft.body} disabled={entry.busy} onChange={event=>edit({body:event.target.value})}/></UiField>
      <UiField label="変更の理由"><UiInput name="summary" aria-label="変更の理由" required maxLength={500} value={entry.draft.summary} disabled={entry.busy} onChange={event=>edit({summary:event.target.value})}/></UiField>
      <UiButton type="submit" disabled={entry.busy||entry.draft.baseVersion!==head}>提案内容を確認</UiButton>
    </form>:null}
    {entry.review?<section className="research-proposal-preview" aria-label="保存する提案の確認">
      <h4>基準 v{entry.review.baseVersion} への変更提案</h4><p>変更の理由: {entry.review.summary}</p><pre className="research-source">{entry.review.body}</pre>
      {entry.uncertain?<p role="status">保存結果が不明です。入力を固定して、同じ内容で確認します。</p>:null}
      <UiButton type="button" disabled={entry.busy} onClick={()=>void save()}>{entry.uncertain?'同じ内容で保存を確認':'確認して提案を保存'}</UiButton>
      {!entry.uncertain?<UiButton type="button" disabled={entry.busy} onClick={()=>{delete entry.review;entry.open=true;sync();}}>編集に戻る</UiButton>:null}
    </section>:null}
    {entry.result?<><p role="status">提案を保存しました。{entry.result.status==='accepted'?'採用済みです。':entry.result.status==='rejected'?'見送り済みです。':''}</p><UiButton type="button" onClick={()=>openProposal(entry.result!.proposalId)}>保存した提案を比較</UiButton><UiButton type="button" disabled={version!==head||!safeVersion(head)} onClick={()=>{delete entry.result;entry.draft={body,summary:'',baseVersion:head};entry.open=true;entry.error='';sync();}}>別の変更を提案</UiButton></>:null}
  </details>;
}
