'use client';
import {ResearchForkChangeExport} from './research-fork-change-export';

import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { V2State } from '@/components/v2/v2-state';
import { ResearchPdfs } from './research-pdfs';
import { ResearchGit } from './research-git';
import { ResearchLinkPicker } from './research-link-picker';
import { ResearchDiscussion, type ResearchDiscussionMemory } from './research-discussion';
import { V2ContentShare } from './v2/v2-content-share';
import { ResearchProposalReviewPanel,type ResearchProposalReviewMemory } from './research-proposal-review';
import { ResearchProposalCreate,researchProposalCreateKey,type ResearchProposalCreateMemory } from './research-proposal-create';
import { UiButton, UiField, UiInput, UiSelect, UiTextarea } from '@/components/ui/primitives';
import { RESEARCH_LINK_KINDS, researchLinkLabels, researchLinkPurposes, researchDocumentHref, type ResearchDocument, type ResearchLinkKind, type ResearchRevision, type ResearchWorkspaceData } from '@/lib/research-workspace';

type DocumentData = { document: ResearchDocument; revision: ResearchRevision; history: {version:number;summary:string}[] };
const kinds = { paper: '論文', software: 'コード', dataset: 'データ', notebook: 'ノート' };
type Props = { projectId:string;canEdit:boolean;signedIn:boolean;viewerId?:string;initialDocument?:string;initialVersion?:string;initialCommit?:string;initialBase?:string;initialGitProposal?:string;projectPublic?:boolean };
export function ResearchDocuments(props: Props) {
  return <DocumentWorkspace key={JSON.stringify([props.projectId,props.viewerId,props.signedIn,props.canEdit,props.projectPublic])} {...props}/>;
}
function DocumentWorkspace({ projectId, canEdit, signedIn, viewerId, initialDocument = '', initialVersion = '', initialCommit = '', initialBase = '', initialGitProposal = '', projectPublic = false }: Props) {
  const endpoint = `/api/research/projects/${encodeURIComponent(projectId)}/workspace`;
  const [data, setData] = useState<ResearchWorkspaceData | null>(null);
  const [selected, setSelected] = useState(initialDocument);
  const [version, setVersion] = useState(initialVersion);
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [generation, refresh] = useState(0);
  const [proposal, setProposal] = useState('');
  const [linkKind, setLinkKind] = useState<ResearchLinkKind | 'all'>('all');
  const selectedVersions = useRef(new Map<string,string>());
  const createdThreads = useRef<ResearchDiscussionMemory>(new Map());
  const proposalReviews = useRef<ResearchProposalReviewMemory>(new Map());
  const proposalCreates = useRef<ResearchProposalCreateMemory>(new Map());
  useEffect(()=>()=>{selectedVersions.current.clear();createdThreads.current.clear();proposalReviews.current.clear();proposalCreates.current.clear();},[]);
  const context = JSON.stringify([projectId,viewerId,signedIn,canEdit,projectPublic]), previousContext=useRef(context);
  useEffect(()=>{if(previousContext.current===context)return;previousContext.current=context;selectedVersions.current.clear();proposalReviews.current.clear();proposalCreates.current.clear();createdThreads.current.clear();setProposal('');setData(null);setDocument(null);refresh(value=>value+1);},[context]);
  useEffect(()=>{const change=()=>{selectedVersions.current.clear();proposalReviews.current.clear();proposalCreates.current.clear();createdThreads.current.clear();setProposal('');setData(null);setDocument(null);refresh(value=>value+1);};window.addEventListener('hub-account-changed',change);return()=>window.removeEventListener('hub-account-changed',change);},[]);
  useEffect(() => {if(initialDocument)selectedVersions.current.set(initialDocument,initialVersion);setSelected(initialDocument);setVersion(initialVersion);setProposal('');setDocument(null);}, [projectId, initialDocument, initialVersion]);
  useEffect(()=>{if(selected)selectedVersions.current.set(selected,version);},[selected,version]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    fetch(endpoint, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!controller.signal.aborted) setData(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || '読み込めませんでした。'); });
    return () => controller.abort();
  }, [endpoint, generation]);
  useEffect(() => {
    setDocument(null);
    if (!selected) return;
    const controller = new AbortController();
    fetch(`${endpoint}?document=${encodeURIComponent(selected)}${version ? `&version=${encodeURIComponent(version)}` : ''}`, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!controller.signal.aborted) setDocument(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message || '本文を読み込めませんでした。'); });
    return () => controller.abort();
  }, [endpoint, selected, version, generation]);
  async function save(payload: Record<string, unknown>) {
    setPending(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.documentId) setSelected(result.documentId);
      setVersion(''); setProposal(''); refresh(value => value + 1); setNotice('保存しました。');
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。'); return false; }
    finally { setPending(false); }
  }
  function submit(action: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void save({ ...Object.fromEntries(new FormData(form)), action }).then(saved => {
      if (saved && (action === 'create' || action === 'link')) {
        form.reset();
        const details = form.closest('details');
        if (details) details.open = false;
      }
    });
  }
  const proposals = data?.proposals.filter(p => p.documentId === selected) ?? [];
  const comparison = proposals.find(p => p.id === proposal);
  const links = data?.links.filter(link => linkKind === 'all' || link.kind === linkKind) ?? [];
  return <section className="research-documents" id="workspace">
    <h2>本文・コードと関連する活動</h2>
    <p>文書ごとに本文と版を保存します。コードは実行されません。変更提案は所有者の採用後に最新版へ反映されます。</p>
    {error ? <p role="alert">{error} <UiButton type="button" onClick={() => refresh(value => value+1)}>再読み込み</UiButton></p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!data && !error ? <p role="status">読み込み中…</p> : null}
    <div className="research-document-layout">
      <div><h3>文書</h3>{data?.documents.map(item => <UiButton type="button" key={item.id} aria-pressed={selected===item.id} onClick={() => {setSelected(item.id);setVersion(selected===item.id?'':selectedVersions.current.get(item.id)??'');setProposal('');setError('');}}>{item.title} · v{item.head}</UiButton>)}
        {data && !data.documents.length ? <V2State kind="empty" icon="edit" compact title="文書はまだありません。" /> : null}
      </div>
      <div>{document ? <>
        <h3>{document.document.title}</h3>
        <UiField label="表示する版"><UiSelect aria-label="表示する版" value={document.revision.version} onChange={e => {setVersion(e.target.value);setProposal('');}}>{document.history.map(item => <option key={item.version} value={item.version}>v{item.version} — {item.summary}</option>)}</UiSelect></UiField>
        <p>{document.document.visibility === 'public' ? '公開' : '非公開'} · {document.revision.contentHash}</p>
        {!comparison && projectPublic && document.document.visibility === 'public' ? <V2ContentShare href={researchDocumentHref(projectId, document.document.id, document.revision.version)}/> : null}
        {canEdit ? <details><summary>公開範囲を変更</summary><p>公開すると、この文書の採用済みの全版を閲覧できます。未採用の提案は公開されません。</p><UiButton type="button" disabled={pending} onClick={() => save({action:'visibility',documentId:selected,visibility:document.document.visibility === 'public' ? 'confidential' : 'public'})}>{document.document.visibility === 'public' ? '非公開にする' : '全版の公開を確定'}</UiButton></details> : null}
        {!comparison?<pre className="research-source">{document.revision.body}</pre>:null}
        {!comparison&&canEdit&&signedIn?<ResearchForkChangeExport key={`${projectId}:${document.document.id}`} projectId={projectId} documentId={document.document.id} body={document.revision.body}/>:null}
        {!comparison?<ResearchDiscussion projectId={projectId} documentId={document.document.id} version={document.revision.version} actorId={viewerId} contentHash={document.revision.contentHash} publicVersion={projectPublic && document.document.visibility === 'public'} signedIn={signedIn} createdThreads={createdThreads.current}/>:null}
        {!comparison && signedIn && (document.revision.version===document.document.head||proposalCreates.current.has(researchProposalCreateKey(projectId,document.document.id)))?<ResearchProposalCreate key={researchProposalCreateKey(projectId,document.document.id)} projectId={projectId} documentId={document.document.id} version={document.revision.version} head={document.document.head} body={document.revision.body} memory={proposalCreates.current} openProposal={id=>{setProposal(id);refresh(value=>value+1);}} reloadDocument={()=>{setVersion('');refresh(value=>value+1);}} onAccessLost={()=>{proposalCreates.current.clear();setData(null);setDocument(null);setProposal('');setError('閲覧権限を確認できません。');refresh(value=>value+1);}}/>:null}
        {proposals.length ? <section><h4>変更提案</h4><p>未採用の本文は提案者と所有者だけが確認できます。</p>{proposals.map(item => <div key={item.id}>
          <UiButton type="button" aria-pressed={proposal===item.id} onClick={() => setProposal(item.id)}>{item.summary} · {item.status === 'open' ? '確認待ち' : item.status === 'accepted' ? '採用済み' : '見送り'}</UiButton>
        </div>)}{comparison&&signedIn ? <ResearchProposalReviewPanel key={`${projectId}:${comparison.id}`} projectId={projectId} proposalId={comparison.id} memory={proposalReviews.current} onAccessLost={()=>{setData(null);setDocument(null);setProposal('');setError('閲覧権限を確認できません。');refresh(value=>value+1);}} openRevision={(documentId,value)=>{setSelected(documentId);setVersion(String(value));setProposal('');}}/> : null}</section> : null}
      </> : selected ? <p>本文を読み込み中…</p> : <p>文書を選ぶと本文と版履歴を確認できます。</p>}</div>
    </div>
    {canEdit ? <details><summary>文書を作成</summary><form onSubmit={e => submit('create',e)}>
      <UiField label="文書名・ファイル名"><UiInput name="title" required maxLength={240}/></UiField>
      <UiField label="種類"><UiSelect name="kind" aria-label="文書の種類">{Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</UiSelect></UiField>
      <UiField label="公開範囲"><UiSelect name="visibility" aria-label="文書の公開範囲" defaultValue="confidential"><option value="confidential">非公開</option><option value="public">公開（プロジェクトが公開の場合）</option></UiSelect></UiField>
      <UiField label="本文・コード"><UiTextarea name="body" required maxLength={100000} rows={14}/></UiField>
      <UiButton disabled={!data} pending={pending}>文書を保存</UiButton>
    </form></details> : null}
    <section id="references"><h3>関連する資料・作品・議論</h3>
      <p className="research-link-hint">関連する解説・実演・議論から、プロジェクトの活動を辿れます。</p>
      {data?.links.length ? <>
        <UiField label="関連先を種類で絞り込む" className="research-link-filter"><UiSelect aria-label="関連先を種類で絞り込む" value={linkKind} onChange={event => setLinkKind(event.target.value as ResearchLinkKind | 'all')}>
          <option value="all">すべて</option>{RESEARCH_LINK_KINDS.map(kind => <option key={kind} value={kind}>{researchLinkLabels[kind]} · {researchLinkPurposes[kind]}</option>)}
        </UiSelect></UiField>
        <p role="status">{links.length}件 / 全{data.links.length}件</p>
      </> : null}
      <div className="research-link-groups">{RESEARCH_LINK_KINDS.filter(kind => links.some(link => link.kind === kind)).map(kind => <section className="research-link-group" key={kind}>
        <h4>{researchLinkLabels[kind]} · {researchLinkPurposes[kind]}</h4>
        <ul className="research-linked-items">{links.filter(link => link.kind === kind).map(link => <li key={`${link.kind}:${link.targetId}`}><a href={link.href}>{researchLinkLabels[link.kind]} · {link.title}</a>{canEdit ? <UiButton type="button" disabled={pending} onClick={() => save({action:'unlink',kind:link.kind,targetId:link.targetId})}>関連を外す</UiButton> : null}</li>)}</ul>
      </section>)}</div>
      {data?.links.length && !links.length ? <p>この種類の関連先はありません。</p> : null}
      {data && !data.links.length ? <p>関連先はまだありません。</p> : null}
      {canEdit ? <details><summary>関連先を追加</summary>
        <ResearchLinkPicker key={projectId} endpoint={endpoint} links={data?.links ?? []} disabled={pending || !data} onAdd={link => save({action:'link',kind:link.kind,targetId:link.targetId})}/>
        <details><summary>URLを貼り付けて追加</summary><form onSubmit={e => submit('link',e)}>
        <UiField label="関連先の種類"><UiSelect name="kind" aria-label="関連先の種類">{RESEARCH_LINK_KINDS.map(kind=><option key={kind} value={kind}>{researchLinkLabels[kind]}</option>)}</UiSelect></UiField>
        <UiField label="関連先のURL" hint="Hubの記事・動画・百科・スレッド・コミュニティのURLを貼り付けます。"><UiInput name="targetId" aria-label="関連先のURL" required maxLength={1000} placeholder="/v2/…"/></UiField>
        <UiButton disabled={!data} pending={pending}>関連づける</UiButton>
      </form></details></details> : null}
    </section>
    <ResearchPdfs key={`pdf-${projectId}`} projectId={projectId} canEdit={canEdit}/>
    <ResearchGit key={`git-${projectId}`} projectId={projectId} actorId={viewerId} canEdit={canEdit} signedIn={signedIn} initialCommit={initialCommit} initialBase={initialBase} initialGitProposal={initialGitProposal} projectPublic={projectPublic}/>
  </section>;
}
