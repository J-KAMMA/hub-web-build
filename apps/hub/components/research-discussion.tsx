'use client';

import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { UiButton, UiField, UiInput, UiSelect, UiTextarea } from '@/components/ui/primitives';
import { BBS_LIMITS, validateThreadContent } from '@/lib/bbs-content-quality';
import { formatResearchDiscussionBody, researchDocumentHref, type ResearchDiscussionSource } from '@/lib/research-workspace';

type Preparation = {source:ResearchDiscussionSource;boards:{key:string;title:string}[];canLink:boolean};
type Draft = {title:string;body:string;boardKey:string;threadType:'question'|'issue'|'discussion'};
type Review = Draft & {requestId:string;source:ResearchDiscussionSource;preview:string};
type Created = {id:string;linked:boolean};
type Remembered = {created?:Created;draft?:Draft;review?:Review;preparation?:Preparation;busy:boolean;locked?:boolean;uncertain?:boolean;sync?:()=>void};
export type ResearchDiscussionMemory = Map<string, Remembered>;
type Props = {projectId:string;documentId:string;version:number;contentHash?:string;actorId?:string;publicVersion:boolean;signedIn:boolean;createdThreads?:ResearchDiscussionMemory};

export function ResearchDiscussion(props: Props) {
  return <DiscussionScope key={JSON.stringify([props.projectId,props.actorId ?? null,props.signedIn])} {...props}/>;
}
function DiscussionScope(props:Props) {
  const memory = useRef<ResearchDiscussionMemory>(new Map());
  const scopeActive=useRef(true);
  const retained=props.createdThreads ?? memory.current;
  const [invalidated,setInvalidated]=useState(false);
  useEffect(()=>{
    if(!props.signedIn){retained.clear();return;}
    for(const key of retained.keys())if(JSON.parse(key)[3]!== (props.actorId ?? null))retained.delete(key);
  },[retained,props.signedIn,props.actorId]);
  useEffect(()=>{
    const change=()=>{scopeActive.current=false;retained.clear();setInvalidated(true);};
    window.addEventListener('hub-account-changed',change);
    return()=>window.removeEventListener('hub-account-changed',change);
  },[retained]);
  if(invalidated)return <p role="alert">アカウントが変わりました。公開版を開き直してください。</p>;
  return <ResearchDiscussionTarget key={JSON.stringify([props.documentId,props.version,props.contentHash ?? null,props.publicVersion])} {...props} createdThreads={retained} scopeActive={scopeActive}/>;
}

function ResearchDiscussionTarget({projectId,documentId,version,contentHash,actorId,publicVersion,signedIn,createdThreads,scopeActive}: Props & {createdThreads:ResearchDiscussionMemory;scopeActive:{current:boolean}}) {
  const endpoint = `/api/research/projects/${encodeURIComponent(projectId)}/workspace`;
  const targetKey = JSON.stringify([projectId,documentId,version,actorId ?? null]);
  const remembered=createdThreads.get(targetKey);
  if(!publicVersion || !signedIn){
    for(const key of createdThreads.keys()){const scope=JSON.parse(key);if(scope[0]===projectId && scope[1]===documentId)createdThreads.delete(key);}
  }
  else if(remembered?.preparation && contentHash!==undefined && remembered.preparation.source.contentHash!==contentHash){
    if(!remembered.locked){delete remembered.preparation;delete remembered.review;delete remembered.created;}
  }
  const restored=publicVersion && signedIn?createdThreads.get(targetKey):undefined;
  const sameSource=contentHash===undefined || restored?.preparation?.source.contentHash===contentHash;
  const [preparation,setPreparation] = useState<Preparation|null>(sameSource?restored?.preparation ?? null:null);
  const [draft,setDraft] = useState<Draft>(restored?.draft ?? restored?.review ?? {title:'',body:'',boardKey:'',threadType:'discussion'});
  const [review,setReview] = useState<Review|null>(sameSource?restored?.review ?? null:null);
  const [created,setCreated] = useState<Created|null>(sameSource?restored?.created ?? null:null);
  const [locked,setLocked] = useState(restored?.locked ?? false);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(restored?.busy ?? false);
  const pending = useRef(false),active = useRef(true),reader = useRef<AbortController|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;reader.current?.abort();};},[]);
  useEffect(()=>{
    if(!remembered)return;
    const sync=()=>{
      const latest=createdThreads.get(targetKey);
      const matches=contentHash===undefined || latest?.preparation?.source.contentHash===contentHash;
      setPreparation(matches?latest?.preparation ?? null:null);setReview(matches?latest?.review ?? null:null);
      setCreated(matches?latest?.created ?? null:null);setLocked(latest?.locked ?? false);setBusy(latest?.busy ?? false);
      if(latest?.draft)setDraft(latest.draft);
      if(!latest?.preparation)setError('公開版を再確認してから作成してください。');
    };
    remembered.sync=sync;
    return()=>{if(remembered.sync===sync)delete remembered.sync;};
  },[remembered,createdThreads,targetKey,contentHash]);
  function edit(next:Partial<Draft>) {if(!scopeActive.current || locked || pending.current)return;const value={...draft,...next};setDraft(value);setReview(null);setError('');const retained=createdThreads.get(targetKey);if(retained){retained.draft=value;delete retained.review;}}
  async function prepare() {
    if(!scopeActive.current || pending.current || locked || !publicVersion || !signedIn || !Number.isSafeInteger(version) || version<1)return;
    pending.current=true;setBusy(true);setError('');
    const controller=new AbortController();reader.current=controller;
    try {
      const response=await fetch(`${endpoint}?discussion=${encodeURIComponent(documentId)}&version=${version}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error || '公開版を確認できませんでした。');
      const source=result.source as ResearchDiscussionSource|undefined;
      if(!source || source.projectId!==projectId || source.documentId!==documentId || source.version!==version || source.href!==researchDocumentHref(projectId,documentId,version) || typeof source.projectTitle!=='string' || typeof source.title!=='string' || typeof source.contentHash!=='string' || (contentHash!==undefined && source.contentHash!==contentHash) || !Array.isArray(result.boards) || result.boards.some((board:{key?:unknown;title?:unknown})=>!board || typeof board.key!=='string' || !board.key || typeof board.title!=='string') || typeof result.canLink!=='boolean')throw new Error('表示中の版と参照情報が一致しません。もう一度確認してください。');
      if(!scopeActive.current || !active.current || controller.signal.aborted)return;
      const next={...draft,boardKey:result.boards.some((board:{key:string})=>board.key===draft.boardKey)?draft.boardKey:result.boards[0]?.key ?? ''};
      createdThreads.set(targetKey,{preparation:result,draft:next,busy:false});setPreparation(result);setDraft(next);setReview(null);
    }catch(cause){if(scopeActive.current && active.current && !controller.signal.aborted)setError(cause instanceof Error?cause.message:'公開版を確認できませんでした。');}
    finally {pending.current=false;if(active.current)setBusy(false);}
  }
  function preview(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!scopeActive.current || pending.current || locked || created || !preparation)return;
    const normalized={...draft,title:draft.title.trim(),body:draft.body.trim()};
    const validation=validateThreadContent(normalized);
    const body=formatResearchDiscussionBody(preparation.source,normalized.body);
    if(validation || body.length>BBS_LIMITS.bodyMax || !preparation.boards.some(board=>board.key===draft.boardKey) || !['question','issue','discussion'].includes(draft.threadType)){
      setError(validation || `参照を含む本文は${BBS_LIMITS.bodyMax}文字以内で、投稿先と種別を選んでください。`);return;
    }
    const confirmed=review ?? {...normalized,source:preparation.source,requestId:crypto.randomUUID(),preview:body};setReview(confirmed);setError('');const retained=createdThreads.get(targetKey);if(retained){retained.review=confirmed;retained.draft=draft;}
  }
  async function create() {
    if(!scopeActive.current)return;
    const acknowledged=createdThreads.get(targetKey)?.created;
    if(acknowledged){setCreated(acknowledged);setReview(null);return;}
    if(pending.current || created || createdThreads.get(targetKey)?.busy || !review || !preparation || !signedIn || !publicVersion)return;
    const wasUncertain=createdThreads.get(targetKey)?.uncertain ?? false;
    const sent:Remembered={review,preparation,draft,busy:true,locked:true,uncertain:wasUncertain};
    createdThreads.set(targetKey,sent);setLocked(true);
    pending.current=true;setBusy(true);setError('');
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({action:'discuss',documentId,version,requestId:review.requestId,source:review.source,title:review.title,body:review.body,boardKey:review.boardKey,threadType:review.threadType})});
      const result=await response.json();
      if(createdThreads.get(targetKey)!==sent)return;
      if(!response.ok){
        if([400,404,409].includes(response.status) && !wasUncertain){
          createdThreads.set(targetKey,{draft:sent.draft,busy:false});
          if(active.current){setLocked(false);setReview(null);setPreparation(null);}
          throw new Error(`${result.error || '参照や入力の確認が拒否されました。'} 公開版を再確認してから作成してください。`);
        }
        throw new Error(result.error || 'スレッドを作成できませんでした。');
      }
      if(typeof result.thread?.id!=='string' || !result.thread.id.trim())throw new Error('作成結果を確認できませんでした。同じ内容で再試行してください。');
      const saved={id:result.thread.id,linked:false};createdThreads.set(targetKey,{created:saved,preparation,busy:false});
      if(active.current){setCreated(saved);setReview(null);}
    }catch(cause){const retained=createdThreads.get(targetKey);if(retained===sent && retained.review && !retained.created)retained.uncertain=true;if(active.current)setError(cause instanceof Error?cause.message:'作成結果を確認できませんでした。同じ内容で再試行してください。');}
    finally{pending.current=false;const retained=createdThreads.get(targetKey);if(retained===sent)retained.busy=false;if(!active.current)sent.sync?.();else setBusy(false);}
  }
  async function link() {
    const retained=createdThreads.get(targetKey),saved=retained?.created;if(!scopeActive.current || !retained || pending.current || retained.busy || !signedIn || !publicVersion || !saved || saved.linked || !preparation?.canLink)return;
    retained.busy=true;
    pending.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({action:'link',kind:'thread',targetId:saved.id})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || '関連付けできませんでした。作成したスレッドは残っています。');
      if(createdThreads.get(targetKey)!==retained)return;
      const next={...saved,linked:true};createdThreads.set(targetKey,{created:next,preparation,busy:false});if(active.current)setCreated(next);
    }catch(cause){if(active.current)setError(cause instanceof Error?cause.message:'関連付けできませんでした。作成したスレッドは残っています。');}
    finally{pending.current=false;const latest=createdThreads.get(targetKey);if(latest===retained)latest.busy=false;if(!active.current)retained.sync?.();else setBusy(false);}
  }
  return <section className="research-discussion" id="research-discussion" aria-label="この版の検証スレッド">
    {!publicVersion ? <p>公開プロジェクトの公開文書だけをスレッドで検証できます。非公開の本文や変更提案は投稿されません。</p> : !signedIn ? <p>検証スレッドを作成するにはHubへログインしてください。</p> : null}
    {created ? <><p role="status">スレッドは作成済みです。{created.linked?'プロジェクトにも関連付けました。':''}</p><div className="research-discussion-actions"><a href={`/v2/threads/${encodeURIComponent(created.id)}`}>作成したスレッドを開く</a><a href={researchDocumentHref(projectId,documentId,version)}>元の文書の版へ戻る</a></div></> : null}
    {!preparation ? <UiButton type="button" disabled={!publicVersion || !signedIn} pending={busy} onClick={prepare}>{created?'関連付けの可否を確認':'この版をスレッドで検証'}</UiButton> : null}
    {preparation && created && signedIn && publicVersion && preparation.canLink && !created.linked ? <UiButton type="button" pending={busy} onClick={link}>このスレッドをプロジェクトに関連付ける</UiButton> : null}
    {preparation && !created && signedIn && publicVersion ? preparation.boards.length ? <form onSubmit={preview}>
      <p><a href={preparation.source.href}>{preparation.source.projectTitle} / {preparation.source.title} · v{version}</a></p>
      <UiField label="スレッドの題" hint="8〜100文字"><UiInput aria-label="スレッドの題" value={draft.title} minLength={BBS_LIMITS.titleMin} maxLength={BBS_LIMITS.titleMax} required disabled={busy || locked} onChange={event=>edit({title:event.target.value})}/></UiField>
      <UiField label="検証したい内容" hint="本人の入力は30文字以上。参照を含む投稿全体は4000文字以内です。"><UiTextarea aria-label="検証したい内容" value={draft.body} rows={6} minLength={BBS_LIMITS.threadBodyMin} maxLength={BBS_LIMITS.bodyMax} required disabled={busy || locked} onChange={event=>edit({body:event.target.value})}/></UiField>
      <UiField label="投稿先の板"><UiSelect value={draft.boardKey} disabled={busy || locked} onChange={event=>edit({boardKey:event.target.value})}>{preparation.boards.map(board=><option key={board.key} value={board.key}>{board.title}</option>)}</UiSelect></UiField>
      <UiField label="スレッドの種別"><UiSelect value={draft.threadType} disabled={busy || locked} onChange={event=>edit({threadType:event.target.value as Draft['threadType']})}><option value="question">質問</option><option value="issue">不具合報告</option><option value="discussion">議題整理</option></UiSelect></UiField>
      <p>アカウント名で、日本語・全地域に公開します。変更提案の本文は含まれません。</p>
      <UiButton type="submit" disabled={busy || locked}>投稿全文を確認</UiButton>
    </form> : <p>投稿できる板がありません。<UiButton type="button" pending={busy} onClick={prepare}>投稿先を再確認</UiButton></p> : null}
    {review && !created && publicVersion && signedIn ? <section className="research-discussion-preview" aria-label="作成するスレッドの確認"><h4>{review.title}</h4><p>{preparation?.boards.find(board=>board.key===review.boardKey)?.title} · {({question:'質問',issue:'不具合報告',discussion:'議題整理'})[review.threadType]} · アカウント名 · 日本語 · 全地域</p><pre className="research-source">{review.preview}</pre><UiButton type="button" tone="primary" pending={busy} onClick={create}>確認してスレッドを作成</UiButton></section> : null}
    {error ? <p role="alert">{error}</p> : null}
    {locked && !created && !busy ? <p role="status">作成結果を確認するまで入力を固定しています。同じ内容で再試行してください。</p> : null}
  </section>;
}
