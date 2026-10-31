'use client';

import React,{useEffect,useId,useRef,useState} from 'react';
import {UiButton,UiInput} from '@/components/ui/primitives';
import {gitCommitOid,parseResearchGitHistory,parseResearchGitCommitDetail,type ResearchGitHistory,type ResearchGitCommitDetail} from '@/lib/research-git-browse';
import {ResearchGitDiscussion,type ResearchGitDiscussionMemory} from './research-git-discussion';
import {V2ContentShare} from './v2/v2-content-share';

type Props={projectId:string;initialCommit?:string;initialBase?:string;publicRepository:boolean;signedIn?:boolean;onComparison?:(detail:ResearchGitCommitDetail|null)=>void};
export function ResearchGitBrowser(props:Props){
  return <GitBrowserScope key={JSON.stringify([props.projectId,props.publicRepository,props.signedIn ?? false])} {...props}/>;
}
function GitBrowserScope(props:Props){
  const createdThreads=useRef<ResearchGitDiscussionMemory>(new Map());
  return <GitBrowserTarget key={JSON.stringify([props.initialCommit??'',props.initialBase??''])} {...props} createdThreads={createdThreads.current}/>;
}
function shortSubject(value:string){const characters=Array.from(value || '件名なし');return characters.length>80?`${characters.slice(0,80).join('')}…`:characters.join('');}
function GitBrowserTarget({projectId,initialCommit='',initialBase='',publicRepository,signedIn=false,onComparison,createdThreads}:Props & {createdThreads:ResearchGitDiscussionMemory}){
  const endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/git/browse`;
  const [selected,setSelected]=useState(initialCommit),[history,setHistory]=useState<ResearchGitHistory|null>(null),[detail,setDetail]=useState<ResearchGitCommitDetail|null>(null);
  const [base,setBase]=useState(initialBase),[baseInput,setBaseInput]=useState(initialBase);
  useEffect(()=>{onComparison?.(detail?.baseOid?detail:null);return()=>onComparison?.(null);},[detail,onComparison]);
  const [historyError,setHistoryError]=useState(''),[detailError,setDetailError]=useState(''),[historyGeneration,reloadHistory]=useState(0),[detailGeneration,reloadDetail]=useState(0);
  const verifiedHistoryGeneration=useRef(-1),verifiedDetailKey=useRef(''),shareAuthority=useRef<object|null>(null),mounted=useRef(true);
  const shareIdentity={selected,base,detail,historyGeneration,detailGeneration};shareAuthority.current=shareIdentity;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [historyExpanded,setHistoryExpanded]=useState(!gitCommitOid(initialCommit));
  const historyId=useId(),selection=useRef<HTMLDivElement|null>(null),focusSelection=useRef(false);
  function selectCommit(oid:string){focusSelection.current=true;setSelected(oid);setHistoryExpanded(false);}
  useEffect(()=>{if(focusSelection.current && selection.current){focusSelection.current=false;selection.current.focus({preventScroll:true});selection.current.scrollIntoView?.({block:'start'});}},[selected,historyExpanded]);
  useEffect(()=>{
    if(!publicRepository)return;
    const controller=new AbortController();setHistory(null);setHistoryError('');
    void fetch(endpoint,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}).then(async response=>{
      const value=await response.json();if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'公開Gitの履歴を読み込めませんでした。');
      const parsed=parseResearchGitHistory(value,projectId);if(!controller.signal.aborted){verifiedHistoryGeneration.current=historyGeneration;setHistory(parsed);}
    }).catch(cause=>{if(!controller.signal.aborted)setHistoryError(cause instanceof Error && cause.message!=='invalid_git_response'?cause.message:'コミット一覧の応答が表示対象と一致しないか、表示上限を超えています。再読み込みしてください。');});
    return()=>controller.abort();
  },[endpoint,projectId,publicRepository,historyGeneration]);
  useEffect(()=>{
    setDetail(null);setDetailError('');if(!publicRepository || !selected)return;
    if(!gitCommitOid(selected)){setDetailError('コミットIDは40桁または64桁の小文字16進数で指定してください。');return;}
    if(base&&(!gitCommitOid(base)||base.length!==selected.length)){setDetailError('比較の基準は、変更後と同じ形式の完全なコミットIDで指定してください。');return;}
    const controller=new AbortController();
    void fetch(`${endpoint}?commit=${selected}${base?`&base=${base}`:''}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}).then(async response=>{
      const value=await response.json();if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'このコミットを読み込めませんでした。');
      const parsed=parseResearchGitCommitDetail(value,projectId,selected,base||undefined);if(!controller.signal.aborted){verifiedDetailKey.current=JSON.stringify([selected,base,detailGeneration]);setDetail(parsed);}
    }).catch(cause=>{if(!controller.signal.aborted)setDetailError(cause instanceof Error && cause.message!=='invalid_git_response'?cause.message:'コミットの応答が表示対象と一致しないか、表示上限を超えています。再読み込みしてください。');});
    return()=>controller.abort();
  },[endpoint,projectId,publicRepository,selected,base,detailGeneration]);
  const href=(oid:string)=>`/v2/research/${encodeURIComponent(projectId)}?commit=${oid}#git`;
  const canShare=!!detail&&detail.commit.oid===selected&&detail.baseOid===(base||undefined)&&history&&!historyError&&!detailError
    &&verifiedHistoryGeneration.current===historyGeneration&&verifiedDetailKey.current===JSON.stringify([selected,base,detailGeneration]);
  if(!publicRepository)return <section className="research-git-browser" aria-label="Gitの変更履歴"><h3>Gitの変更履歴</h3><p>公開リポジトリの変更履歴を閲覧できます。このリポジトリは非公開か、公開範囲を確認できないため表示できません。</p></section>;
  return <section className="research-git-browser" aria-label="Gitの変更履歴"><h3>Gitの変更履歴</h3><p>最新20件から固定コミットを選び、親コミットや変更差分を辿れます。コードは実行されません。</p>
    <details open={!!base}><summary>二つの版を比較する</summary><p>基準を選び、履歴から変更後のコミットを選択してください。公開された同じリポジトリ内の二つの版を比較します。</p>
      <label>基準のコミットID<UiInput aria-label="比較の基準コミットID" value={baseInput} maxLength={64} onChange={event=>setBaseInput(event.target.value)} spellCheck={false}/></label>
      <UiButton type="button" disabled={!gitCommitOid(baseInput)||baseInput===base} onClick={()=>{setDetail(null);setBase(baseInput);setHistoryExpanded(true);}}>このIDを基準にする</UiButton>
      {base?<UiButton type="button" onClick={()=>{setDetail(null);setBase('');setBaseInput('');}}>比較を終了</UiButton>:null}
    </details>
    <UiButton className="research-git-history-toggle" type="button" aria-expanded={historyExpanded} aria-controls={historyId} onClick={()=>setHistoryExpanded(value=>!value)}>{historyExpanded?'履歴をたたむ':'最近のコミットを表示'}</UiButton>
    {historyError?<p role="alert">{historyError} <UiButton type="button" onClick={()=>reloadHistory(value=>value+1)}>履歴を再読み込み</UiButton></p>:null}
    <div className="research-git-history" id={historyId}>{historyExpanded?historyError?null:!history?<p role="status">コミット一覧を読み込み中…</p>:history.commits.length?<ol className="research-git-commits" aria-label="最近のコミット">{history.commits.map(commit=><li key={commit.oid}><UiButton type="button" aria-label={`${commit.subject || '件名なし'} · ${commit.oid.slice(0,12)}`} title={commit.subject || '件名なし'} aria-pressed={selected===commit.oid} onClick={()=>selectCommit(commit.oid)}>{shortSubject(commit.subject)} · {commit.oid.slice(0,12)}</UiButton><time dateTime={commit.committedAt}>{new Date(commit.committedAt).toLocaleString('ja-JP')}</time><a href={href(commit.oid)}>このコミットのURL</a></li>)}</ol>:<p>コミットはまだありません。</p>:null}</div>
    <div className="research-git-selection" ref={selection} tabIndex={-1} aria-label="選択したコミット">
    {selected && gitCommitOid(selected)?<p className="research-git-links"><a href={href(selected)}>選択したコミットのURL</a></p>:null}
    {gitCommitOid(selected)&&gitCommitOid(base)&&base.length===selected.length?<p><a href={`/v2/research/${encodeURIComponent(projectId)}?commit=${selected}&base=${base}#git`}>二つの版の比較URL</a></p>:null}
    {detailError?<p role="alert">{detailError}{gitCommitOid(selected)?<UiButton type="button" onClick={()=>reloadDetail(value=>value+1)}>このコミットを再読み込み</UiButton>:null}</p>:selected && !detail?<p role="status">コミットの変更内容を読み込み中…</p>:null}
    {detail?<section className="research-git-detail" aria-label="選択したコミットの変更内容"><h4 aria-label={detail.commit.subject || '件名なし'} title={detail.commit.subject || '件名なし'}>{shortSubject(detail.commit.subject)}</h4><p><code>{detail.commit.oid}</code> · <time dateTime={detail.commit.committedAt}>{new Date(detail.commit.committedAt).toLocaleString('ja-JP')}</time></p>
      {canShare?<div className="research-git-links" onClickCapture={event=>{if(!mounted.current||shareAuthority.current!==shareIdentity||!event.currentTarget.isConnected||!selection.current?.contains(event.currentTarget))event.preventDefault();}}><V2ContentShare href={`/v2/research/${encodeURIComponent(projectId)}?commit=${detail.commit.oid}${detail.baseOid?`&base=${detail.baseOid}`:''}#git`}/></div>:null}
      <UiButton type="button" disabled={base===detail.commit.oid} onClick={()=>{setDetail(null);setBase(detail.commit.oid);setBaseInput(detail.commit.oid);setHistoryExpanded(true);}}>このコミットを比較の基準にする</UiButton>
      <div className="research-git-links" aria-label="親コミット">{detail.commit.parentOids.length?detail.commit.parentOids.map(oid=><span key={oid}><UiButton type="button" onClick={()=>selectCommit(oid)}>親コミットを見る · {oid.slice(0,12)}</UiButton><a href={href(oid)}>親コミットのURL</a></span>):<p>親コミットのない最初のコミットです。</p>}</div>
      <ResearchGitDiscussion projectId={projectId} oid={detail.commit.oid} publicRepository={publicRepository} signedIn={signedIn} createdThreads={createdThreads}/>
      <pre className="research-source">{detail.commit.message}</pre>
      <h5>変更されたファイル</h5>{detail.files.length?<ul className="research-git-files">{detail.files.map(file=><li key={JSON.stringify([file.path,file.oldPath])}><span>{({A:'追加',M:'変更',D:'削除',T:'種類変更',R:'名前変更',C:'コピー'} as Record<string,string>)[file.status[0]]} ({file.status})</span> <code>{file.oldPath?`${file.oldPath} → ${file.path}`:file.path}</code></li>)}</ul>:<p>表示できるファイル変更はありません。</p>}
      <h5>差分</h5>{detail.baseOid?<p>基準 <code>{detail.baseOid}</code> → 変更後 <code>{detail.commit.oid}</code> の全体差分です。</p>:<p>差分は最初の親コミットとの比較です。最初のコミットは追加内容を表示します。</p>}{detail.diff?<pre className="research-source">{detail.diff}</pre>:<p>表示できるテキスト差分はありません。</p>}
      {detail.truncated?<p role="status">表示上限のため、変更説明・ファイル一覧・差分の一部を省略しています。全体はGitでこのコミットを取得して確認してください。</p>:null}
      {detail.baseOid&&detail.baseOid!==detail.commit.oid?<details><summary>別のHubへこの変更を渡す</summary><p>この二版のファイル変更を、バイナリを含むGitパッチで保存します（最大16MiB）。画面で省略された差分も含みます。履歴・提案の理由・レビュー結果は含みません。</p><a href={`/api/research/projects/${encodeURIComponent(projectId)}/git/patch?base=${detail.baseOid}&head=${detail.commit.oid}`} target="_blank" rel="noreferrer">二版の変更パッチをダウンロード</a><p>受け取った側は同じ基準版の作業用コピーで内容と利用条件を確認し、Gitで適用可否を確かめてから適用してください。Hubはコードを実行・反映しません。P2Pのファイル送信でも渡せます。</p><pre className="research-source">git apply --check CHANGE.patch{'\n'}git apply --index CHANGE.patch</pre><p>変更後に自分のHubへpushし、そのHubの提案・レビューへ進めます。コミットIDと履歴をそのまま複製する場合はGit bundleを使ってください。LFSの実体とサブモジュールの中身は含みません。</p></details>:null}
    </section>:!selected?<p>コミットを選ぶと変更説明と差分を確認できます。</p>:null}
    </div>
  </section>;
}
