'use client';

import React,{useEffect,useRef,useState} from 'react';
import {UiButton,UiInput} from '@/components/ui/primitives';
import {researchTargetId,researchTargetPath} from '@/lib/research-workspace';

type Link={linkId:string;threadId:string;linked:boolean;available:boolean;title:string|null;href:string|null};
type Data={proposalId:string;canManage:boolean;links:Link[]};
type Mutation={action:'link';requestId:string;threadId:string;expectedLinkId:string|null}|{action:'unlink';linkId:string;threadId:string};
type Entry={data?:Data;input?:string;confirmation?:Mutation;busy?:boolean;uncertain?:boolean;conflicted?:boolean;error?:string;notice?:string;sync?:()=>void;reading?:AbortController};
export type ResearchProposalDiscussionsMemory=Map<string,Entry>;
type Props={projectId:string;proposalId:string;memory:ResearchProposalDiscussionsMemory;isCurrent?:()=>boolean;onAccessLost?:()=>void};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const title=(value:unknown):value is string=>typeof value==='string'&&value.length<=240&&!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value);
function checked(value:Data,proposalId:string){
  if(new TextEncoder().encode(JSON.stringify(value)).length>100000||value?.proposalId!==proposalId||typeof value.canManage!=='boolean'||!Array.isArray(value.links)||value.links.length>100)throw Error('議論の一覧を確認できません。');
  const threads=new Set<string>(),links=new Set<string>();
  for(const link of value.links){
    if(!uuid(link.linkId)||!id(link.threadId)||threads.has(link.threadId)||links.has(link.linkId)||typeof link.linked!=='boolean'||typeof link.available!=='boolean'||(link.available?(!title(link.title)||link.href!==researchTargetPath('thread',link.threadId)):(link.title!==null||link.href!==null)))throw Error('議論の一覧を確認できません。');
    threads.add(link.threadId);links.add(link.linkId);
  }
  return value;
}

export function ResearchProposalDiscussions({projectId,proposalId,memory,isCurrent=()=>true,onAccessLost}:Props){
  const key=JSON.stringify([projectId,proposalId]),[entry]=useState(()=>{const current=memory.get(key)??{};memory.set(key,current);return current;}),[,refresh]=useState(0);
  const reader=useRef<AbortController|null>(null),valid=()=>isCurrent()&&memory.get(key)===entry,sync=()=>entry.sync?.();
  const endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}/discussions`;
  function denied(){delete entry.data;entry.input='';memory.delete(key);onAccessLost?.();sync();}
  async function read(){
    if(!valid()||entry.busy)return;
    const controller=new AbortController();reader.current?.abort();reader.current=controller;entry.reading=controller;entry.busy=true;entry.error='';sync();
    try{
      const response=await fetch(endpoint,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),value=await response.json();
      if(!valid()||controller.signal.aborted)return;
      if(!response.ok){delete entry.data;if([401,403,404].includes(response.status))denied();throw Error(value.error??'議論を読み込めませんでした。');}
      entry.data=checked(value,proposalId);
      if(!entry.uncertain)delete entry.confirmation;
    }catch(error){if(valid()&&!controller.signal.aborted){delete entry.data;entry.error=error instanceof Error?error.message:'議論を読み込めませんでした。';}}
    finally{if(valid()&&entry.reading===controller){delete entry.reading;entry.busy=false;sync();}}
  }
  useEffect(()=>{entry.sync=()=>refresh(value=>value+1);if(!entry.busy)void read();return()=>{delete entry.sync;reader.current?.abort();if(entry.reading===reader.current){delete entry.reading;entry.busy=false;}};},[entry]);
  function preview(link?:Link){
    if(!valid()||entry.busy||entry.uncertain||!entry.data?.canManage)return;
    entry.error='';entry.notice='';entry.conflicted=false;
    if(link){entry.confirmation=Object.freeze({action:'unlink',linkId:link.linkId,threadId:link.threadId});sync();return;}
    const threadId=researchTargetId('thread',entry.input??'',window.location.origin);
    if(!id(threadId)){entry.error='公開スレッドのURLまたはIDを入力してください。';sync();return;}
    const old=entry.data.links.find(item=>item.threadId===threadId);
    if(old?.linked){entry.error='この議論はすでに関連付けられています。';sync();return;}
    entry.confirmation=Object.freeze({action:'link',requestId:crypto.randomUUID(),threadId,expectedLinkId:old?.linkId??null});sync();
  }
  async function save(){
    const mutation=entry.confirmation;if(!valid()||entry.busy||!entry.data?.canManage||!mutation)return;
    const wasUncertain=entry.uncertain===true;entry.busy=true;entry.error='';sync();
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify(mutation)}),value=await response.json();
      if(!valid())return;
      if(!response.ok){
        if([401,403,404].includes(response.status)){denied();return;}
        if(response.status===409)delete entry.data;
        if([400,409].includes(response.status)&&!wasUncertain){delete entry.confirmation;entry.uncertain=false;}else entry.uncertain=true;
        entry.conflicted=wasUncertain&&response.status===409;
        throw Error(value.error??'結果を確認できません。同じ操作で再試行してください。');
      }
      const expectedId=mutation.action==='link'?mutation.requestId:mutation.linkId;
      if(value.proposalId!==proposalId||value.threadId!==mutation.threadId||value.linkId!==expectedId||typeof value.linked!=='boolean'||(mutation.action==='unlink'&&value.linked))throw Error('保存結果を確認できません。同じ操作で再試行してください。');
      entry.notice=value.linked?'議論を関連付けました。':'関連付けは解除されています。';entry.uncertain=false;entry.conflicted=false;delete entry.confirmation;entry.input='';entry.busy=false;await read();
    }catch(error){if(valid()){if(entry.confirmation)entry.uncertain=true;entry.error=error instanceof Error?error.message:'結果を確認できません。同じ操作で再試行してください。';}}
    finally{if(valid()){entry.busy=false;sync();}}
  }
  if(!valid())return <p role="status">接続または閲覧権限が変わりました。提案を選び直してください。</p>;
  const data=entry.data,confirmation=entry.confirmation;
  const superseded=()=>{const operation=entry.confirmation,current=entry.data?.links.find(link=>link.threadId===operation?.threadId);return Boolean(valid()&&entry.conflicted&&entry.uncertain&&entry.data?.canManage&&operation&&current&&(operation.action==='link'?current.linkId!==operation.requestId&&current.linkId!==operation.expectedLinkId:current.linkId!==operation.linkId));};
  return <section className="research-proposal-discussions" aria-label="この提案に関連する議論">
    <h5>関連する議論</h5>
    <p>公開スレッドを参照します。提案の本文や変更理由は転載せず、この関連付けも公開しません。</p>
    {entry.error?<p role="alert">{entry.error}</p>:null}{entry.notice?<p role="status">{entry.notice}</p>:null}
    <UiButton size="compact" disabled={entry.busy} onClick={()=>void read()}>議論の一覧を再確認</UiButton>
    {!data&&!entry.error?<p role="status">議論を読み込み中…</p>:null}
    {data?<>
      {!data.links.some(link=>link.linked)?<p>関連する議論はありません。</p>:null}
      <ul className="research-discussion-links">{data.links.filter(link=>link.linked).map(link=><li key={link.linkId}>
        {link.available?<a href={link.href!}>{link.title}</a>:<span>現在参照できない議論</span>}
        {data.canManage?<UiButton size="compact" disabled={entry.busy||entry.uncertain} onClick={()=>preview(link)}>関連付けを解除</UiButton>:null}
      </li>)}</ul>
      {data.canManage?<form className="research-edit-form" onSubmit={event=>{event.preventDefault();preview();}}>
        <label>公開スレッドのURLまたはID<UiInput value={entry.input??''} maxLength={500} disabled={entry.busy||entry.uncertain} onChange={event=>{entry.input=event.target.value;delete entry.confirmation;sync();}}/></label>
        <UiButton size="compact" type="submit" disabled={entry.busy||entry.uncertain}>関連付けを確認</UiButton>
      </form>:null}
    </>:null}
    {confirmation?<section className="research-proposal-preview" aria-label="議論の関連付けの確認">
      <p>{confirmation.action==='link'?'この公開スレッドを提案に関連付けます。':'提案との関連付けだけを解除します。スレッドは削除しません。'}</p>
      <a href={researchTargetPath('thread',confirmation.threadId)}>{confirmation.threadId}</a>
      {entry.uncertain?<p role="status">結果が不明です。同じ操作で確認します。</p>:null}
      {!data?.canManage?<p>関連付けの管理権限を再確認してください。</p>:null}
      <UiButton size="compact" disabled={entry.busy||!data?.canManage} onClick={()=>void save()}>{entry.uncertain?'同じ関連付け操作で結果を確認':'確認して保存'}</UiButton>
      {superseded()?<><p>関連付けは別の操作で更新されています。現在の状態を確認して、以前の操作を閉じます。再送しません。</p><UiButton size="compact" disabled={entry.busy} onClick={()=>{if(entry.busy||!superseded())return;delete entry.confirmation;entry.uncertain=false;entry.conflicted=false;entry.input='';entry.error='';entry.notice='現在の関連付けを確認しました。';sync();}}>現在の関連を確認して操作を閉じる</UiButton></>:null}
      {!entry.uncertain?<UiButton size="compact" disabled={entry.busy} onClick={()=>{delete entry.confirmation;sync();}}>関連付けの確認を取り消す</UiButton>:null}
    </section>:null}
  </section>;
}
