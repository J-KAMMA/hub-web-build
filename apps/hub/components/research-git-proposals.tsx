'use client';
import React,{useEffect,useRef,useState,type FormEvent} from 'react';
import {UiButton,UiField,UiInput,UiTextarea} from './ui/primitives';
import type {ResearchGitCommitDetail} from '@/lib/research-git-browse';
import {ResearchGitApplication,type GitApplicationEntry} from './research-git-application';
import {ResearchGitChangeExport,ResearchGitChangeImport} from './research-git-change-transfer';
import {gitComparisonHash,gitProposalId,gitProposalText,parseGitProposal,parseGitProposalPage,parseGitProposalReview,type GitProposal,type GitProposalCreate,type GitProposalDecision,type GitProposalPage,type GitProposalReview} from '@/lib/research-git-proposals';
const labels={open:'レビュー待ち',approved:'レビュー承認済み（反映状態は別途確認）',rejected:'却下'};
const href=(project:string,id:string)=>`/v2/research/${encodeURIComponent(project)}?gitProposal=${id}#git`;
async function request(url:string,body?:unknown){const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(typeof value.error==='string'?value.error:'Gitの提案を確認できません。');return value;}
type Creation={id:string;title:string;summary:string;open?:boolean;review?:GitProposalCreate;result?:GitProposal;busy?:boolean;sent?:boolean;error?:string;sync?:()=>void};
type Decision={body?:GitProposalDecision;busy?:boolean;error?:string;sent?:boolean;sync?:()=>void};
type Props={projectId:string;signedIn:boolean;comparison:ResearchGitCommitDetail|null;initialProposal?:string};
export function ResearchGitProposals(props:Props){return <ProposalScope key={JSON.stringify([props.projectId,props.signedIn])} {...props}/>;}
function ProposalScope(props:Props){
  const [epoch,setEpoch]=useState(0),memory=useRef({creates:new Map<string,Creation>(),decisions:new Map<string,Decision>(),applications:new Map<string,GitApplicationEntry>()});
  useEffect(()=>{const clear=()=>{memory.current.creates.clear();memory.current.decisions.clear();memory.current.applications.clear();setEpoch(value=>value+1);};window.addEventListener('hub-account-changed',clear);return()=>window.removeEventListener('hub-account-changed',clear);},[]);
  return <ProposalWorkspace key={epoch} {...props} memory={memory.current}/>;
}
function ProposalWorkspace({projectId,signedIn,comparison,initialProposal='',memory}:Props & {memory:{creates:Map<string,Creation>;decisions:Map<string,Decision>;applications:Map<string,GitApplicationEntry>}}){
  const [open,setOpen]=useState(!!initialProposal),[selected,setSelected]=useState(initialProposal),[page,setPage]=useState<GitProposalPage|null>(null),[cursor,setCursor]=useState<string>(),[generation,refresh]=useState(0),[error,setError]=useState('');
  const endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/git/proposals`,life=useRef(0);
  const [importedComparison,setImportedComparison]=useState<ResearchGitCommitDetail|null>(null),[receiving,setReceiving]=useState(false),mounted=useRef(true),currentComparison=importedComparison??comparison;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setImportedComparison(null);},[comparison]);
  useEffect(()=>{const invitation=()=>{if(!new URLSearchParams(window.location.search).has('gitBundle')&&window.location.hash.startsWith('#pair='))setReceiving(true);};invitation();window.addEventListener('hashchange',invitation);return()=>window.removeEventListener('hashchange',invitation);},[]);
  function importDraft(value:{comparison:ResearchGitCommitDetail;title:string;summary:string}){
    if(!mounted.current||!signedIn||value.comparison.projectId!==projectId)throw Error('接続が変わりました。受信内容を読み直してください。');
    const key=JSON.stringify([value.comparison.baseOid,value.comparison.commit.oid]),entry=memory.creates.get(key);
    if(entry&&(entry.busy||entry.review||entry.sent||entry.result||entry.title&&entry.title!==value.title||entry.summary&&entry.summary!==value.summary))throw Error('この二版には既存の入力・保存確認があります。下書きを保護するため取り込めません。');
    const draft=entry??{id:crypto.randomUUID(),title:'',summary:''};
    Object.assign(draft,{title:value.title,summary:value.summary,open:true});memory.creates.set(key,draft);draft.sync?.();setImportedComparison(value.comparison);setOpen(true);
  }
  useEffect(()=>{setSelected(initialProposal);if(initialProposal)setOpen(true);},[initialProposal]);
  useEffect(()=>{const token=++life.current;setPage(null);setError('');if(!open||!signedIn)return;
    void request(endpoint+(cursor?'?cursor='+encodeURIComponent(cursor):'')).then(value=>{if(token===life.current)setPage(parseGitProposalPage(value,projectId));}).catch(e=>{if(token===life.current)setError(e instanceof Error?e.message:'一覧を確認できません。');});return()=>{life.current++;};
  },[endpoint,projectId,signedIn,open,cursor,generation]);
  const saved=(id:string)=>{setSelected(id);refresh(value=>value+1);};
  return <section aria-label="Gitの変更提案" style={{minWidth:0,overflowWrap:'anywhere'}}><UiButton type="button" size="compact" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Gitの提案をたたむ':'Gitの変更提案を見る'}</UiButton>
    <details open={receiving} onToggle={e=>setReceiving(e.currentTarget.open)}><summary>別のHubから提案内容を受け取る</summary><ResearchGitChangeImport projectId={projectId} signedIn={signedIn} onImport={importDraft}/></details>
    {open?<><h3>Gitの変更提案</h3><p>提案の理由は本人とプロジェクト所有者だけが確認できます。レビューの承認ではGitのブランチを更新しません。</p>
      {!signedIn?<p>ログインしてGitの変更提案を確認してください。</p>:<>
        {currentComparison?.baseOid&&currentComparison.baseOid!==currentComparison.commit.oid?<ProposalCreate key={JSON.stringify([currentComparison.baseOid,currentComparison.commit.oid])} projectId={projectId} comparison={currentComparison} endpoint={endpoint} memory={memory.creates} saved={saved}/>:<p>提案を作るには、上のGit履歴で基準版と変更後の版を比較してください。</p>}
        {error?<p role="alert">{error} <UiButton type="button" size="compact" onClick={()=>refresh(value=>value+1)}>提案一覧を再読み込み</UiButton></p>:!page?<p role="status">提案一覧を読み込み中…</p>:page.proposals.length?<ul>{page.proposals.map(item=><li key={item.id}><UiButton type="button" size="compact" onClick={()=>setSelected(item.id)}>{item.title}</UiButton> · {labels[item.status]}{item.mine?' · 自分の提案':''} · <a href={href(projectId,item.id)}>提案のURL</a></li>)}</ul>:<p>閲覧できるGitの提案はありません。</p>}
        {cursor?<UiButton type="button" size="compact" onClick={()=>setCursor(undefined)}>最新の提案へ</UiButton>:null}{page?.nextCursor?<UiButton type="button" size="compact" onClick={()=>setCursor(page.nextCursor!)}>次の50件</UiButton>:null}
        {selected?<ProposalReview key={selected} projectId={projectId} id={selected} endpoint={endpoint} memory={memory.decisions} applications={memory.applications} changed={()=>refresh(value=>value+1)}/>:null}
      </>}
    </>:null}
  </section>;
}
function ProposalCreate({projectId,comparison,endpoint,memory,saved}:{projectId:string;comparison:ResearchGitCommitDetail;endpoint:string;memory:Map<string,Creation>;saved:(id:string)=>void}){
  const key=JSON.stringify([comparison.baseOid,comparison.commit.oid]),[entry]=useState(()=>{const value=memory.get(key)??{id:crypto.randomUUID(),title:'',summary:''};memory.set(key,value);return value;}),[,refresh]=useState(0),mounted=useRef(true);
  const valid=()=>memory.get(key)===entry,sync=()=>entry.sync?.();
  useEffect(()=>{mounted.current=true;const update=()=>refresh(value=>value+1);entry.sync=update;return()=>{mounted.current=false;if(entry.sync===update)delete entry.sync;};},[entry]);
  async function preview(event:FormEvent){event.preventDefault();if(!valid()||entry.busy||entry.sent||entry.result)return;entry.busy=true;entry.error='';sync();
    try{const title=entry.title.trim(),summary=entry.summary.trim();if(!gitProposalText(title,240)||!gitProposalText(summary,500)||!comparison.baseOid)throw Error('題と変更の理由を確認してください。');const comparisonHash=await gitComparisonHash(comparison);if(valid())entry.review={action:'create',requestId:entry.id,baseOid:comparison.baseOid,headOid:comparison.commit.oid,title,summary,comparisonHash};}catch(e){if(valid())entry.error=e instanceof Error?e.message:'提案を準備できません。';}finally{if(valid()){entry.busy=false;sync();}}
  }
  async function save(readOnly=false){if(!valid()||entry.busy||!entry.review)return;entry.busy=true;entry.error='';const review=Object.freeze({...entry.review});entry.review=review;if(!readOnly)entry.sent=true;sync();
    try{const raw=await request(endpoint+(readOnly?'?proposal='+entry.id:''),readOnly?undefined:review);const result=readOnly?parseGitProposalReview(raw,projectId,entry.id).proposal:parseGitProposal(raw,projectId,entry.id);
      if(!result.mine||result.baseOid!==review.baseOid||result.headOid!==review.headOid||result.title!==review.title||result.summary!==review.summary)throw Error('保存された内容を確認できません。操作IDを維持して確認してください。');
      if(valid()){entry.result=result;delete entry.review;entry.sent=false;if(mounted.current)saved(result.id);}
    }catch(e){if(valid())entry.error=e instanceof Error?e.message:'保存結果を確認できません。';}finally{if(valid()){entry.busy=false;sync();}}
  }
  if(!valid())return null;
  if(entry.result)return <p>操作IDに保存済みの提案：{entry.result.title} · {labels[entry.result.status]} <UiButton type="button" size="compact" onClick={()=>saved(entry.result!.id)}>保存した提案を開く</UiButton></p>;
  return <details open={entry.open} onToggle={e=>{entry.open=e.currentTarget.open;}}><summary>比較中の二版を提案する</summary><p>基準 <code>{comparison.baseOid}</code> → 変更後 <code>{comparison.commit.oid}</code></p>
    {entry.error?<p role="alert">{entry.error}</p>:null}
    {entry.review?<section aria-label="Git提案の保存確認"><h4>{entry.review.title}</h4><p>{entry.review.summary}</p><p>この二版と理由を保存します。コードの実行・反映は行いません。</p>{entry.sent?<p>保存結果は未確認です。同じ操作IDを保持しています。</p>:null}
      <UiButton type="button" size="compact" pending={entry.busy} onClick={()=>void save()}>{entry.sent?'同じ提案の保存を確認':'確認してGit提案を保存'}</UiButton>
      {entry.sent?<UiButton type="button" size="compact" disabled={entry.busy} onClick={()=>void save(true)}>このIDの保存結果を読む</UiButton>:null}
      <UiButton type="button" size="compact" disabled={entry.busy||entry.sent} onClick={()=>{if(!valid()||entry.busy||entry.sent)return;delete entry.review;sync();}}>操作IDを保持して入力へ戻る</UiButton>
    </section>:<form onSubmit={event=>void preview(event)}><UiField label="提案の題"><UiInput aria-label="Git提案の題" required maxLength={240} value={entry.title} disabled={entry.busy||entry.sent} onChange={e=>{if(entry.sent||entry.result)return;entry.title=e.target.value;sync();}}/></UiField><UiField label="変更の理由"><UiTextarea aria-label="Git変更の理由" required maxLength={500} rows={3} value={entry.summary} disabled={entry.busy||entry.sent} onChange={e=>{if(entry.sent||entry.result)return;entry.summary=e.target.value;sync();}}/></UiField><UiButton type="submit" size="compact" pending={entry.busy}>提案内容を確認</UiButton></form>}
    <details><summary>この二版の提案内容を別のHubへ渡す</summary><ResearchGitChangeExport comparison={comparison} title={entry.title} summary={entry.summary}/></details>
  </details>;
}
function ProposalReview({projectId,id,endpoint,memory,applications,changed}:{projectId:string;id:string;endpoint:string;memory:Map<string,Decision>;applications:Map<string,GitApplicationEntry>;changed:()=>void}){
  const [data,setData]=useState<GitProposalReview|null>(null),[generation,refresh]=useState(0),[error,setError]=useState(''),[full,setFull]=useState(false),[entry]=useState(()=>{const value=memory.get(id)??{};memory.set(id,value);return value;}),[,render]=useState(0),life=useRef(0);
  const valid=()=>memory.get(id)===entry,sync=()=>entry.sync?.();
  useEffect(()=>{const update=()=>render(value=>value+1);entry.sync=update;return()=>{if(entry.sync===update)delete entry.sync;};},[entry]);
  useEffect(()=>{const token=++life.current;setData(null);setError('');setFull(false);if(!gitProposalId(id)){setError('提案IDが不正です。');return;}
    void request(endpoint+'?proposal='+id).then(value=>{if(valid()&&token===life.current)setData(parseGitProposalReview(value,projectId,id));}).catch(e=>{if(valid()&&token===life.current)setError(e instanceof Error?e.message:'提案を読めません。');});return()=>{life.current++;};
  },[endpoint,projectId,id,generation]);
  function prepare(action:'approve'|'reject'){if(!valid()||!data?.canReview||entry.busy)return;entry.body={action,proposalId:id,snapshot:data.snapshot,...(action==='approve'?{comparisonHash:data.comparisonHash,fullReviewConfirmed:full}:{})};entry.sent=false;entry.error='';sync();}
  async function save(){const body=entry.body,token=life.current;if(!body||!valid()||entry.busy||!data?.canManage)return;entry.busy=true;entry.sent=true;entry.error='';sync();
    try{const value=parseGitProposal(await request(endpoint,body),projectId,id);if(value.status!==(body.action==='approve'?'approved':'rejected'))throw Error('レビュー結果を確認できません。');if(valid()){delete entry.body;entry.sent=false;if(token===life.current){refresh(value=>value+1);changed();}}}
    catch(e){if(valid())entry.error=e instanceof Error?e.message:'レビュー結果を確認できません。';}finally{if(valid()){entry.busy=false;sync();}}
  }
  return <section aria-label="Git提案のレビュー">{error?<p role="alert">{error}</p>:!data?<p role="status">Git提案を読み込み中…</p>:<><h4>{data.proposal.title}</h4><p>{labels[data.proposal.status]}</p><p>{data.proposal.summary}</p><p>基準 <code>{data.proposal.baseOid}</code> → 変更後 <code>{data.proposal.headOid}</code></p><a href={href(projectId,id)}>この提案のURL</a>
    {data.comparison?<><h5>保存した二版の差分</h5><pre className="research-source">{data.comparison.diff||'表示できるテキスト差分はありません。'}</pre>{data.comparison.truncated?<><p>表示上限のため差分の一部を省略しています。Gitで二版の全体を確認してください。</p><label><input type="checkbox" checked={full} disabled={!!entry.body} onChange={e=>setFull(e.target.checked)}/>Gitで二版の全体を確認した</label></>:null}</>:data.comparisonError?<p role="status">{data.comparisonError}</p>:null}
    {data.canReview&&!entry.body?<><UiButton type="button" size="compact" disabled={!data.comparison||data.comparison.truncated&&!full} onClick={()=>prepare('approve')}>レビューを承認</UiButton><UiButton type="button" size="compact" onClick={()=>prepare('reject')}>提案を却下</UiButton></>:null}
    {data.canManage&&data.proposal.status==='approved'?<ResearchGitApplication projectId={projectId} review={data} memory={applications}/>:null}
    {data.comparison?<details><summary>この提案内容を別のHubへ渡す</summary><ResearchGitChangeExport comparison={data.comparison} title={data.proposal.title} summary={data.proposal.summary}/></details>:null}
  </>}
    {entry.error?<p role="alert">{entry.error}</p>:null}
    {entry.body?<section aria-label="Gitレビューの確定確認"><p>{entry.body.action==='approve'?'この二版のレビューを承認します。Gitのブランチはまだ更新しません。':'この変更提案を却下します。Gitのコードは変更しません。'}</p>{entry.sent?<p>結果は未確認です。同じ判断を保持しています。</p>:null}<UiButton type="button" size="compact" pending={entry.busy} disabled={!valid()||!data?.canManage} onClick={()=>void save()}>{entry.sent?'同じレビューの結果を確認':'確認してレビューを確定'}</UiButton>{!entry.sent?<UiButton type="button" size="compact" onClick={()=>{delete entry.body;sync();}}>レビューの選択へ戻る</UiButton>:null}</section>:null}
    <UiButton type="button" size="compact" disabled={entry.busy} onClick={()=>refresh(value=>value+1)}>この提案の現在状態を読む</UiButton>
  </section>;
}
