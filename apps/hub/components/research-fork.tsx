"use client";
import React,{useEffect,useRef,useState} from 'react';
import type {ResearchForkSource,prepareResearchFork} from '@/lib/server/research-fork';
import {UiButton,UiLinkButton} from '@/components/ui/primitives';
import {researchForkPackagePath} from '@/lib/research-fork-package';

type Info={source:ResearchForkSource|null;preview:Awaited<ReturnType<typeof prepareResearchFork>>|null};
export function ResearchFork({projectId,signedIn,basePath,remoteOrigin}:{projectId:string;signedIn:boolean;basePath:string;remoteOrigin?:string}) {
  const [info,setInfo]=useState<Info|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[confirmed,setConfirmed]=useState(false),[saved,setSaved]=useState<{id:string;title:string}|null>(null),[invalidated,setInvalidated]=useState(false);
  const live=useRef(true),generation=useRef(0), operation=useRef<Record<string,unknown>|null>(null);
  const url=remoteOrigin?`/api/research/network-fork?${new URLSearchParams({origin:remoteOrigin,projectId})}`:`/api/research/projects/${encodeURIComponent(projectId)}/fork`;
  async function read(signal?:AbortSignal) {
    const current=generation.current;
    setError('');
    try {
      const response=await fetch(url,{cache:'no-store',signal:signal??AbortSignal.timeout(15000)}),result=await response.json();
      if(!response.ok)throw Error(result.error??'fork情報を確認できませんでした。');
      if(live.current&&current===generation.current)setInfo(result);
    }catch(cause){if(live.current&&current===generation.current&&!signal?.aborted)setError(cause instanceof Error?cause.message:'確認できませんでした。');}
  }
  useEffect(()=>{
    live.current=true;const abort=new AbortController();void read(abort.signal);
    const invalidate=()=>{live.current=false;generation.current++;abort.abort();operation.current=null;setInfo(null);setSaved(null);setInvalidated(true);};
    window.addEventListener('hub-account-changed',invalidate);
    return()=>{live.current=false;generation.current++;abort.abort();window.removeEventListener('hub-account-changed',invalidate);};
  },[url]);
  async function create() {
    if(pending||invalidated||!info?.preview||!confirmed)return;
    const current=generation.current;
    operation.current??={requestId:crypto.randomUUID(),snapshotHash:info.preview.snapshotHash,rightsConfirmed:true,...(remoteOrigin?{origin:remoteOrigin,projectId}:{})};
    setPending(true);setError('');
    try {
      const response=await fetch(url,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation.current),signal:AbortSignal.timeout(15000)}),result=await response.json();
      if(!live.current||current!==generation.current)return;
      if(!response.ok){if([400,403,404,409,429].includes(response.status)){operation.current=null;setConfirmed(false);setInfo(null);}throw Error(result.error??'forkを保存できませんでした。');}
      if(!result.project||typeof result.project.id!=='string'||!/^rp_[a-f0-9]{32}$/.test(result.project.id)||result.project.id.length!==35)throw Error('保存結果を確認できませんでした。同じ操作IDで確認し直せます。');
      setSaved(result.project);
    }catch(cause){if(live.current&&current===generation.current)setError(cause instanceof Error?cause.message:'保存結果を確認できませんでした。');}
    finally{if(live.current&&current===generation.current)setPending(false);}
  }
  if(invalidated)return <p role="status">接続が変わりました。画面を再読み込みしてください。</p>;
  const Preview=remoteOrigin?'div':'details';
  return <section aria-label="プロジェクトの派生" className="research-editor">
    {info?.source?<p>派生元：<a href={info.source.href} target="_blank" rel="noreferrer">{info.source.title}</a> · 複製時の版とハッシュを記録しています。</p>:null}
    {info?.preview?<Preview>{remoteOrigin?<p>{info.preview.title} · {remoteOrigin}</p>:<summary>自分のプロジェクトとしてfork</summary>}
      <p>公開文書・コードの最新版{info.preview.documentCount}件を、自分だけが見られる新しいプロジェクトへ複製します。原本は変更されません。</p>
      <p>ライセンス：{info.preview.license??'未設定。公開されているだけでは再利用の許可になりません。'}</p>
      <p>Git履歴・PDF・課題・変更提案は含みません。Git履歴はGitの持ち出し機能を使います。</p>
      <p><a href={(remoteOrigin??'')+researchForkPackagePath(projectId)} download>公開版をJSONで持ち出す</a> · 元のHub・文書の版・ハッシュを含みます。</p>
      {saved?<UiLinkButton href={`${basePath}/${saved.id}`}>作成したforkを開く</UiLinkButton>:signedIn?<>
        <label><input type="checkbox" checked={confirmed} disabled={pending||Boolean(operation.current)} onChange={e=>setConfirmed(e.target.checked)}/>ライセンスと権利者の許可を確認しました</label>
        <UiButton type="button" pending={pending} disabled={!confirmed} onClick={()=>void create()}>{operation.current?'同じforkの保存結果を確認':'非公開のforkを作成'}</UiButton>
      </>:<p>forkを作成するにはHubへログインしてください。</p>}
    </Preview>:null}
    {error?<p role="alert">{error}</p>:null}
    {error&&!operation.current?<UiButton type="button" onClick={()=>void read()}>派生元を再確認</UiButton>:null}
  </section>;
}
