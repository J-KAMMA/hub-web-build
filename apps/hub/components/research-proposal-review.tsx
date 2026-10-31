'use client';

import React,{useEffect,useRef,useState} from 'react';
import {UiButton} from '@/components/ui/primitives';
import {researchDocumentHref,type ResearchProposalReview,type ResearchProposalSnapshot} from '@/lib/research-workspace';
import {ResearchProposalDiscussions,type ResearchProposalDiscussionsMemory} from './research-proposal-discussions';

type Action='accept'|'reject';
type Decision={proposalId:string;status:'accepted'|'rejected';adoptedRevision:ResearchProposalReview['adoptedRevision']};
type Entry={data?:ResearchProposalReview;confirmation?:{action:Action;snapshot:ResearchProposalSnapshot;documentId:string;proposalContentHash:string};result?:Decision;busy?:boolean;uncertain?:boolean;error?:string;sync?:()=>void;reading?:AbortController;discussions?:ResearchProposalDiscussionsMemory};
export type ResearchProposalReviewMemory=Map<string,Entry>;
type Props={projectId:string;proposalId:string;memory:ResearchProposalReviewMemory;openRevision:(documentId:string,version:number)=>void;onAccessLost?:()=>void};
const hash=(value:unknown)=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
const version=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
function checked(value:ResearchProposalReview,projectId:string,proposalId:string){
  const {proposal,document,baseRevision,snapshot,adoptedRevision}=value;
  if(new TextEncoder().encode(JSON.stringify(value)).length>1024*1024||proposal?.id!==proposalId||document?.projectId!==projectId||proposal.documentId!==document.id||!version(proposal.baseVersion)||!version(document.head)||baseRevision?.version!==proposal.baseVersion||!text(proposal.body,100000)||!text(baseRevision.body,100000)||!text(proposal.summary,500)||!text(document.title,240)||!hash(proposal.contentHash)||!hash(baseRevision.contentHash)||!['open','accepted','rejected'].includes(proposal.status)||!['public','confidential'].includes(document.visibility)||typeof value.canDecide!=='boolean'||typeof value.canDiscuss!=='boolean'||snapshot?.proposalId!==proposalId||snapshot.baseVersion!==proposal.baseVersion||snapshot.currentHead!==document.head||snapshot.baseHash!==baseRevision.contentHash||!hash(snapshot.proposalHash))throw new Error('提案と基準版の応答を確認できません。');
  if(proposal.status==='accepted'?(!version(adoptedRevision?.version)||adoptedRevision.version!==proposal.baseVersion+1||adoptedRevision.contentHash!==proposal.contentHash||adoptedRevision.href!==researchDocumentHref(projectId,document.id,adoptedRevision.version)):adoptedRevision!==null)throw new Error('採用版を確認できません。');
  return value;
}

export function ResearchProposalReviewPanel({projectId,proposalId,memory,openRevision,onAccessLost}:Props){
  const key=JSON.stringify([projectId,proposalId]),[entry]=useState(()=>{const current=memory.get(key)??{};memory.set(key,current);return current;}),[,refresh]=useState(0);
  const reader=useRef<AbortController|null>(null),valid=()=>memory.get(key)===entry,sync=()=>entry.sync?.();
  entry.discussions??=new Map();
  function clearDiscussions(){for(const discussion of entry.discussions!.values())discussion.reading?.abort();entry.discussions!.clear();}
  const endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`;
  async function read(){
    if(!valid()||entry.busy)return;
    reader.current?.abort();const controller=new AbortController();reader.current=controller;entry.reading=controller;entry.busy=true;entry.error='';sync();
    try{
      const response=await fetch(endpoint,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),value=await response.json();
      if(!valid()||controller.signal.aborted)return;
      if(!response.ok){delete entry.data;if(!entry.uncertain)delete entry.confirmation;if([401,403,404].includes(response.status)){clearDiscussions();onAccessLost?.();}throw new Error(value.error??'提案を読み込めませんでした。');}
      const data=checked(value,projectId,proposalId);
      if(entry.confirmation&&!entry.uncertain&&JSON.stringify(entry.confirmation.snapshot)!==JSON.stringify(data.snapshot))delete entry.confirmation;
      entry.data=data;
    }catch(error){if(valid()&&!controller.signal.aborted){delete entry.data;entry.error=error instanceof Error?error.message:'提案を読み込めませんでした。';}}
    finally{if(valid()&&entry.reading===controller){delete entry.reading;entry.busy=false;sync();}}
  }
  useEffect(()=>{entry.sync=()=>refresh(value=>value+1);if(!entry.busy)void read();return()=>{delete entry.sync;reader.current?.abort();if(entry.reading===reader.current){delete entry.reading;entry.busy=false;}};},[entry]);
  function preview(action:Action){
    const data=entry.data;if(!valid()||entry.busy||entry.uncertain||entry.result||!data?.canDecide||data.proposal.status!=='open'||(action==='accept'&&(data.document.head!==data.proposal.baseVersion||!version(data.proposal.baseVersion+1))))return;
    entry.confirmation={action,snapshot:Object.freeze({...data.snapshot}),documentId:data.document.id,proposalContentHash:data.proposal.contentHash};entry.error='';sync();
  }
  async function decide(){
    const confirmation=entry.confirmation;if(!valid()||entry.busy||entry.result||!confirmation)return;
    const wasUncertain=entry.uncertain===true;entry.busy=true;entry.error='';sync();
    try{
      const response=await fetch(`/api/research/projects/${encodeURIComponent(projectId)}/workspace`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({action:confirmation.action,proposalId,snapshot:confirmation.snapshot})}),value=await response.json();
      if(!valid())return;
      if(!response.ok){
        if([401,403,404,409].includes(response.status))delete entry.data;
        if([401,403,404].includes(response.status))clearDiscussions();
        if([401,403,404].includes(response.status))onAccessLost?.();
        if([400,401,403,404,409].includes(response.status)&&!wasUncertain){delete entry.confirmation;entry.uncertain=false;}else entry.uncertain=true;
        throw new Error(value.error??'結果を確認できません。同じ操作で再試行してください。');
      }
      const expected=confirmation.action==='accept'?'accepted':'rejected',adopted=value.adoptedRevision;
      if(value.proposalId!==proposalId||value.status!==expected||(expected==='accepted'?(!version(adopted?.version)||adopted.version!==confirmation.snapshot.baseVersion+1||!hash(adopted.contentHash)||adopted.contentHash!==confirmation.proposalContentHash||adopted.href!==researchDocumentHref(projectId,confirmation.documentId,adopted.version)):adopted!==null))throw new Error('結果を確認できません。同じ操作で再試行してください。');
      entry.result={proposalId,status:expected,adoptedRevision:adopted?{version:adopted.version,contentHash:adopted.contentHash,href:adopted.href}:null};entry.uncertain=false;delete entry.confirmation;
    }catch(error){if(valid()){if(entry.confirmation)entry.uncertain=true;entry.error=error instanceof Error?error.message:'結果を確認できません。同じ操作で再試行してください。';}}
    finally{if(valid()){entry.busy=false;sync();}}
  }
  if(!valid())return <p role="status">接続が変わりました。提案を選び直してください。</p>;
  const data=entry.data,confirmation=entry.confirmation;
  return <section className="research-proposal-review" aria-label="変更提案の比較と確認">
    <h4>変更提案の比較</h4>
    {entry.error?<p role="alert">{entry.error}</p>:null}
    <UiButton type="button" disabled={entry.busy} onClick={()=>void read()}>提案の状態を再確認</UiButton>
    {!data&&!entry.error?<p role="status">読み込み中…</p>:null}
    {data?<>
      <p>{data.document.title} · 基準v{data.proposal.baseVersion} / 最新v{data.document.head} · {data.document.visibility==='public'?'採用済みの版は公開':'非公開'}</p>
      <p>変更の理由: {data.proposal.summary}</p><p>未採用の提案本文は、提案者と所有者だけが読めます。</p>
      <div className="research-proposal-comparison">
        <section aria-label="基準版の本文"><h5>基準版 v{data.baseRevision.version}</h5><code>{data.baseRevision.contentHash}</code><pre className="research-source">{data.baseRevision.body}</pre></section>
        <section aria-label="提案の本文"><h5>提案された本文</h5><code>{data.proposal.contentHash}</code><pre className="research-source">{data.proposal.body}</pre></section>
      </div>
      <UiButton type="button" onClick={()=>openRevision(data.document.id,data.proposal.baseVersion)}>{data.canDiscuss?'基準版を開く・検証する':'基準版を開く'}</UiButton>
      {!data.canDiscuss?<p>この基準版は公開スレッドの参照に使えません。</p>:null}
      {!entry.result&&data.proposal.status==='open'&&data.canDecide?<>
        {data.document.head!==data.proposal.baseVersion?<p>別の変更が先に採用されています。この提案は採用できません。最新版を確認してください。</p>:null}
        <UiButton type="button" disabled={entry.busy||entry.uncertain||data.document.head!==data.proposal.baseVersion||!version(data.proposal.baseVersion+1)} onClick={()=>preview('accept')}>採用内容を確認</UiButton>
        <UiButton type="button" disabled={entry.busy||entry.uncertain} onClick={()=>preview('reject')}>見送り内容を確認</UiButton>
      </>:null}
      {!entry.result&&data.proposal.status!=='open'?<p role="status">{data.proposal.status==='accepted'?'採用済み':'見送り済み'}</p>:null}
      {data.adoptedRevision?<UiButton type="button" onClick={()=>openRevision(data.document.id,data.adoptedRevision!.version)}>採用された版を開く</UiButton>:null}
      <ResearchProposalDiscussions {...{projectId,proposalId}} memory={entry.discussions} isCurrent={valid} onAccessLost={()=>{delete entry.data;clearDiscussions();onAccessLost?.();sync();}}/>
    </>:null}
    {confirmation?<section className="research-proposal-preview" aria-label="採否の確認">
      <h5>{confirmation.action==='accept'?'この提案を採用する':'この提案を見送る'}</h5>
      <p>{confirmation.action==='accept'?`基準v${confirmation.snapshot.baseVersion}からv${confirmation.snapshot.baseVersion+1}を作成します。文書が公開なら、新しい版も公開されます。`:'文書の本文は変更せず、この提案を見送り済みにします。'}</p>
      <p>提案本文をスレッドへ自動で転載しません。</p>
      {entry.uncertain?<p role="status">結果が不明です。別の操作へ変更せず、同じ内容で結果を確認します。</p>:null}
      <UiButton type="button" disabled={entry.busy} onClick={()=>void decide()}>{entry.uncertain?'同じ操作で結果を確認':confirmation.action==='accept'?'確認して採用':'確認して見送り'}</UiButton>
      {!entry.uncertain?<UiButton type="button" disabled={entry.busy} onClick={()=>{delete entry.confirmation;sync();}}>確認を取り消す</UiButton>:null}
    </section>:null}
    {entry.result?<p role="status">{entry.result.status==='accepted'?'採用を保存しました。':'見送りを保存しました。'}</p>:null}
    {entry.result?.adoptedRevision?<a href={entry.result.adoptedRevision.href}>採用された固定版へ戻る</a>:null}
  </section>;
}
