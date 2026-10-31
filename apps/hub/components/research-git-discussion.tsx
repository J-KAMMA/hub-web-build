'use client';

import React,{useEffect,useRef,useState,type FormEvent} from 'react';
import {UiButton,UiField,UiInput,UiSelect,UiTextarea} from '@/components/ui/primitives';
import {BBS_LIMITS,validateThreadContent} from '@/lib/bbs-content-quality';
import {gitCommitOid} from '@/lib/research-git-browse';
import {formatResearchGitDiscussionBody,researchGitCommitHref,type ResearchGitDiscussionSource} from '@/lib/research-git-discussion';

type Preparation={source:ResearchGitDiscussionSource;boards:{key:string;title:string}[];canLink:boolean};
type Draft={title:string;body:string;boardKey:string;threadType:'question'|'issue'|'discussion'};
type Review=Draft & {requestId:string;source:ResearchGitDiscussionSource;preview:string};
type Created={id:string;linked:boolean};
type Remembered={preparation?:Preparation;draft?:Draft;review?:Review;created?:Created;busy:boolean;locked?:boolean;uncertain?:boolean;sync?:()=>void};
export type ResearchGitDiscussionMemory=Map<string,Remembered>;
type Props={projectId:string;oid:string;publicRepository:boolean;signedIn:boolean;createdThreads?:ResearchGitDiscussionMemory};

export function ResearchGitDiscussion(props:Props){
  return <GitDiscussionScope key={JSON.stringify([props.projectId,props.publicRepository,props.signedIn])} {...props}/>;
}
function GitDiscussionScope(props:Props){
  const memory=useRef<ResearchGitDiscussionMemory>(new Map());
  return <GitDiscussionTarget key={props.oid} {...props} createdThreads={props.createdThreads ?? memory.current}/>;
}
function GitDiscussionTarget({projectId,oid,publicRepository,signedIn,createdThreads}:Props & {createdThreads:ResearchGitDiscussionMemory}){
  const endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/git/discussion`,workspace=`/api/research/projects/${encodeURIComponent(projectId)}/workspace`,key=JSON.stringify([projectId,oid]),remembered=createdThreads.get(key);
  const [preparation,setPreparation]=useState<Preparation|null>(remembered?.preparation ?? null),[review,setReview]=useState<Review|null>(remembered?.review ?? null),[created,setCreated]=useState<Created|null>(remembered?.created ?? null);
  const [draft,setDraft]=useState<Draft>(remembered?.draft ?? remembered?.review ?? {title:'',body:'',boardKey:'',threadType:'discussion'}),[locked,setLocked]=useState(remembered?.locked ?? false),[busy,setBusy]=useState(remembered?.busy ?? false),[error,setError]=useState('');
  const pending=useRef(false),active=useRef(true),reader=useRef<AbortController|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;reader.current?.abort();};},[]);
  useEffect(()=>{
    if(!remembered)return;
    const sync=()=>{const latest=createdThreads.get(key);setPreparation(latest?.preparation ?? null);setReview(latest?.review ?? null);setCreated(latest?.created ?? null);setLocked(latest?.locked ?? false);setBusy(latest?.busy ?? false);if(latest?.draft)setDraft(latest.draft);if(!latest?.preparation)setError('公開コミットを再確認してから作成してください。');};
    remembered.sync=sync;return()=>{if(remembered.sync===sync)delete remembered.sync;};
  },[remembered,createdThreads,key]);
  function edit(next:Partial<Draft>){if(locked || pending.current)return;const value={...draft,...next};setDraft(value);setReview(null);setError('');const retained=createdThreads.get(key);if(retained){retained.draft=value;delete retained.review;}}
  async function prepare(){
    if(pending.current || locked || !publicRepository || !signedIn || !gitCommitOid(oid))return;
    pending.current=true;setBusy(true);setError('');const controller=new AbortController();reader.current=controller;
    try{
      const response=await fetch(`${endpoint}?commit=${oid}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}),result=await response.json();if(!response.ok)throw new Error(result.error || '公開コミットを確認できませんでした。');
      const source=result.source as ResearchGitDiscussionSource|undefined;
      const safeMetadata=(value:unknown)=>typeof value==='string' && value.trim().length>0 && value.length<=240 && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value);
      if(!source || source.projectId!==projectId || source.oid!==oid || source.href!==researchGitCommitHref(projectId,oid) || !safeMetadata(source.projectTitle) || !safeMetadata(source.subject) || !Array.isArray(result.boards) || result.boards.some((board:{key?:unknown;title?:unknown})=>!board || typeof board.key!=='string' || !board.key || typeof board.title!=='string') || typeof result.canLink!=='boolean')throw new Error('表示中のコミットと参照情報が一致しません。もう一度確認してください。');
      if(active.current && !controller.signal.aborted){const prepared={source:{projectId,projectTitle:source.projectTitle,oid,subject:source.subject,href:source.href},boards:result.boards,canLink:result.canLink},next={...draft,boardKey:result.boards.some((board:{key:string})=>board.key===draft.boardKey)?draft.boardKey:result.boards[0]?.key ?? ''};createdThreads.set(key,{preparation:prepared,draft:next,busy:false});setPreparation(prepared);setDraft(next);}
    }catch(cause){if(active.current && !controller.signal.aborted)setError(cause instanceof Error?cause.message:'公開コミットを確認できませんでした。');}
    finally{pending.current=false;if(active.current)setBusy(false);}
  }
  function preview(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(pending.current || locked || created || !preparation)return;
    const normalized={...draft,title:draft.title.trim(),body:draft.body.trim()},validation=validateThreadContent(normalized),body=formatResearchGitDiscussionBody(preparation.source,normalized.body);
    if(validation || body.length>BBS_LIMITS.bodyMax || !preparation.boards.some(board=>board.key===draft.boardKey) || !['question','issue','discussion'].includes(draft.threadType)){setError(validation || '参照を含む本文は4000文字以内で、投稿先と種別を選んでください。');return;}
    const confirmed=review ?? {...normalized,source:preparation.source,requestId:crypto.randomUUID(),preview:body};setReview(confirmed);setError('');const retained=createdThreads.get(key);if(retained){retained.review=confirmed;retained.draft=draft;}
  }
  async function create(){
    const acknowledged=createdThreads.get(key)?.created;if(acknowledged){setCreated(acknowledged);setReview(null);return;}
    if(pending.current || created || createdThreads.get(key)?.busy || !review || !preparation || !signedIn || !publicRepository)return;
    const wasUncertain=createdThreads.get(key)?.uncertain ?? false,sent:Remembered={review,preparation,draft,busy:true,locked:true,uncertain:wasUncertain};createdThreads.set(key,sent);setLocked(true);pending.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({action:'discuss_git',oid,requestId:review.requestId,source:review.source,title:review.title,body:review.body,boardKey:review.boardKey,threadType:review.threadType})}),result=await response.json();
      if(!response.ok){if([400,404,409].includes(response.status) && !wasUncertain){createdThreads.set(key,{draft:sent.draft,busy:false});if(active.current){setLocked(false);setReview(null);setPreparation(null);}throw new Error(`${result.error || '参照や入力の確認が拒否されました。'} 公開コミットを再確認してから作成してください。`);}throw new Error(result.error || 'スレッドを作成できませんでした。');}
      if(typeof result.thread?.id!=='string' || !result.thread.id.trim())throw new Error('作成結果を確認できませんでした。同じ内容で再試行してください。');
      const saved={id:result.thread.id,linked:false};createdThreads.set(key,{created:saved,preparation,busy:false});if(active.current){setCreated(saved);setReview(null);}
    }catch(cause){const retained=createdThreads.get(key);if(retained?.review && !retained.created)retained.uncertain=true;if(active.current)setError(cause instanceof Error?cause.message:'作成結果を確認できませんでした。同じ内容で再試行してください。');}
    finally{pending.current=false;const retained=createdThreads.get(key);if(retained)retained.busy=false;if(!active.current)sent.sync?.();else setBusy(false);}
  }
  async function link(){
    const retained=createdThreads.get(key),saved=retained?.created;if(!retained || pending.current || retained.busy || !signedIn || !publicRepository || !saved || saved.linked || !preparation?.canLink)return;
    retained.busy=true;pending.current=true;setBusy(true);setError('');
    try{const response=await fetch(workspace,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({action:'link',kind:'thread',targetId:saved.id})}),result=await response.json();if(!response.ok)throw new Error(result.error || '関連付けできませんでした。作成したスレッドは残っています。');const next={...saved,linked:true};createdThreads.set(key,{created:next,preparation,busy:false});if(active.current)setCreated(next);}
    catch(cause){if(active.current)setError(cause instanceof Error?cause.message:'関連付けできませんでした。作成したスレッドは残っています。');}
    finally{pending.current=false;const latest=createdThreads.get(key);if(latest)latest.busy=false;if(!active.current)retained.sync?.();else setBusy(false);}
  }
  return <section className="research-git-discussion research-discussion" aria-label="このコミットの検証スレッド">
    {!publicRepository?<p>公開プロジェクトの公開Gitコミットだけをスレッドで検証できます。</p>:!signedIn?<p>検証スレッドを作成するにはHubへログインしてください。</p>:null}
    <p>自分の質問・検証内容と固定コミットの短い参照を投稿します。差分やコミットの変更説明は自動で転載しません。</p>
    {created?<><p role="status">スレッドは作成済みです。{created.linked?'プロジェクトにも関連付けました。':''}</p><div className="research-discussion-actions"><a href={`/v2/threads/${encodeURIComponent(created.id)}`}>作成したスレッドを開く</a><a href={researchGitCommitHref(projectId,oid)}>元のコミットへ戻る</a></div></>:null}
    {!preparation?<UiButton type="button" disabled={!publicRepository || !signedIn || !gitCommitOid(oid)} pending={busy} onClick={prepare}>{created?'関連付けの可否を確認':'このコミットをスレッドで検証'}</UiButton>:null}
    {preparation && created && signedIn && publicRepository && preparation.canLink && !created.linked?<UiButton type="button" pending={busy} onClick={link}>このスレッドをプロジェクトに関連付ける</UiButton>:null}
    {preparation && !created && signedIn && publicRepository?preparation.boards.length?<form onSubmit={preview}>
      <p><a href={preparation.source.href}>{preparation.source.projectTitle} / {preparation.source.subject} · {oid.slice(0,12)}</a></p>
      <UiField label="スレッドの題" hint="8〜100文字"><UiInput aria-label="スレッドの題" value={draft.title} minLength={BBS_LIMITS.titleMin} maxLength={BBS_LIMITS.titleMax} required disabled={busy || locked} onChange={event=>edit({title:event.target.value})}/></UiField>
      <UiField label="検証したい内容" hint="本人の入力は30文字以上。参照を含む投稿全体は4000文字以内です。"><UiTextarea aria-label="検証したい内容" value={draft.body} rows={6} minLength={BBS_LIMITS.threadBodyMin} maxLength={BBS_LIMITS.bodyMax} required disabled={busy || locked} onChange={event=>edit({body:event.target.value})}/></UiField>
      <UiField label="投稿先の板"><UiSelect value={draft.boardKey} disabled={busy || locked} onChange={event=>edit({boardKey:event.target.value})}>{preparation.boards.map(board=><option key={board.key} value={board.key}>{board.title}</option>)}</UiSelect></UiField>
      <UiField label="スレッドの種別"><UiSelect value={draft.threadType} disabled={busy || locked} onChange={event=>edit({threadType:event.target.value as Draft['threadType']})}><option value="question">質問</option><option value="issue">不具合報告</option><option value="discussion">議題整理</option></UiSelect></UiField>
      <p>アカウント名で、日本語・全地域に公開します。</p><UiButton type="submit" disabled={busy || locked}>投稿全文を確認</UiButton>
    </form>:<p>投稿できる板がありません。<UiButton type="button" pending={busy} onClick={prepare}>投稿先を再確認</UiButton></p>:null}
    {review && !created && publicRepository && signedIn?<section className="research-discussion-preview" aria-label="作成するスレッドの確認"><h4>{review.title}</h4><p>{preparation?.boards.find(board=>board.key===review.boardKey)?.title} · {({question:'質問',issue:'不具合報告',discussion:'議題整理'})[review.threadType]} · アカウント名 · 日本語 · 全地域</p><pre className="research-source">{review.preview}</pre><UiButton type="button" tone="primary" pending={busy} onClick={create}>確認してスレッドを作成</UiButton></section>:null}
    {error?<p role="alert">{error}</p>:null}{locked && !created && !busy?<p role="status">作成結果を確認するまで入力を固定しています。同じ内容で再試行してください。</p>:null}
  </section>;
}
