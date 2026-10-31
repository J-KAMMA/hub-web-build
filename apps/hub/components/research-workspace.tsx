"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import {HubNetworkCard,HubNetworkStatus,useHubNetwork} from './hub-network';
import {hubCatalogResearchQuery} from '@/lib/hub-network-client';
import { ResearchDocuments } from './research-documents';
import { ResearchGitHub } from './research-github';
import {ResearchFork} from './research-fork';
import { RESEARCH_OBJECT_TYPES, RESEARCH_VISIBILITIES } from "@/lib/desci-core";
import type { ResearchObject, ResearchProject, ResearchRelation } from "@/lib/server/d1-research";
import { UiButton, UiField, UiInput, UiLinkButton, UiSelect, UiStatePanel, UiTextarea } from "@/components/ui/primitives";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Empty } from "@/components/v2/v2-empty";

const typeLabels: Record<string, string> = {
  question: "研究課題", hypothesis: "仮説", protocol: "プロトコル", preregistration: "事前登録",
  experiment_run: "実験記録", dataset: "データセット", software: "ソフトウェア", model: "モデル",
  notebook: "ノートブック", claim: "主張", evidence: "根拠", review: "レビュー",
  replication: "追試", paper: "論文", license: "ライセンス",
};
const visibilityLabels: Record<string, string> = {
  public: "公開", embargoed: "公開猶予", controlled: "申請制", confidential: "機密", restricted: "限定",
};
const relationLabels: Record<string, string> = {
  supported_by: "根拠が支持", contradicted_by: "根拠が反証", replicated_by: "追試で再現",
  supersedes: "新版として置換", derived_from: "派生元", uses_protocol: "手順を使用",
  included_in: "成果に収録", reviewed_by: "レビュー済み",
};
const statusLabels: Record<string, string> = { draft: "準備中", active: "進行中", paused: "中断中", completed: "完了", withdrawn: "撤回済み", pending: "確認待ち", unreviewed: "未レビュー", in_review: "レビュー中", changes_requested: "修正依頼", accepted: "採択", rejected: "不採択", unknown: "未確認" };
const objectGroups = [
  { id: "all", label: "すべて", types: [] },
  { id: "code", label: "コード", types: ["software", "model", "notebook"] },
  { id: "papers", label: "論文", types: ["paper", "review"] },
  { id: "data", label: "データ・実験", types: ["dataset", "experiment_run", "protocol", "preregistration", "replication"] },
  { id: "other", label: "その他", types: ["question", "hypothesis", "claim", "evidence", "license"] },
];

async function submitJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "保存できませんでした。");
}

/*
 * 研究の経路の根（2026-09-04）。
 *
 * この部品は /research と /v2/research の両方で使う。行き先を "/research" に
 * 焼き込んでいたため、v2 の一覧から作業場を押すと v2 の外へ出て、
 * /v2/research/[projectId] にはどこからも入口が無かった。
 */
const DEFAULT_RESEARCH_BASE = "/research";

export function ResearchIndex({
  projects,
  signedIn,
  unavailable = false,
  basePath = DEFAULT_RESEARCH_BASE,
  v2 = false,
}: {
  projects: ResearchProject[];
  signedIn: boolean;
  unavailable?: boolean;
  basePath?: string;
  /* v2 の一覧面。頭・検索1行・カード・空の状態に並べ直す。 */
  v2?: boolean;
}) {
  const [panel, setPanel] = useState<"" | "create" | "github">("");
  /* 読み手が居る面。v2 から描かれたら入口も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await submitJson("/api/research/projects", Object.fromEntries(data));
      location.reload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "作成できませんでした。");
    } finally {
      setPending(false);
    }
  }
  const createForm = !signedIn ? <><p>作成するにはHubへログインしてください。</p><UiLinkButton href={hubSurfacePath(surface, "/auth")} tone="primary">ログインへ</UiLinkButton></> :
    <form onSubmit={create}>
      <UiField label="プロジェクト名" required><UiInput name="title" required minLength={3} maxLength={240} /></UiField>
      <UiField label="概要"><UiTextarea name="description" maxLength={5000} rows={4} /></UiField>
      <div className="v2-rl-create__pair">
        <UiField label="公開範囲"><UiSelect name="visibility" defaultValue="public">{RESEARCH_VISIBILITIES.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}</UiSelect></UiField>
        <UiField label="既定ライセンス"><UiInput name="defaultLicense" placeholder="例: CC BY 4.0" maxLength={200} /></UiField>
      </div>
      {message ? <p role="alert" className="research-error">{message}</p> : null}
      <div className="v2-rl-create__actions"><UiButton tone="primary" pending={pending} pendingLabel="作成中…">作成</UiButton><UiButton type="button" onClick={() => setPanel("")}>閉じる</UiButton></div>
    </form>;
  if (v2) return <section className="v2-rl">
    <V2ColumnHead heading title="研究" action={<>
      <button type="button" className="v2-button v2-button--primary" aria-expanded={panel === "create"} onClick={() => setPanel(panel === "create" ? "" : "create")}><span className="v2-button__label">新しいプロジェクト</span></button>
    </>} />
    {panel === "create" ? <div className="v2-rl-create" id="create">{createForm}</div> : null}
    {panel === "github" ? <div className="v2-rl-github" id="github"><ResearchGitHub /></div> : null}
    <ResearchProjectList projects={projects} signedIn={signedIn} unavailable={unavailable} basePath={basePath} v2 onCreate={() => setPanel("create")} githubOpen={panel === "github"} onGithub={() => setPanel(panel === "github" ? "" : "github")} />
  </section>;
  return <section className="research-page">
    <header className="research-hero">
      <h1>研究</h1>
      <p>コード、論文、データ、実験の成果をプロジェクトにまとめます。本文の版管理、変更提案、関連する作品や議論を一か所で確認できます。</p>
    </header>
    <a href="#github">GitHubの公開リポジトリを確認</a>
    <div className="research-layout">
      <ResearchProjectList projects={projects} signedIn={signedIn} unavailable={unavailable} basePath={basePath}/>
      {/* 一覧を先に見せる。作る欄は押したときだけ開く。 */}
      <details className="research-create">
        <summary>新しいプロジェクト</summary>
        {!signedIn ? <><p>作成するにはHubへログインしてください。</p><UiLinkButton href={hubSurfacePath(surface, "/auth")} tone="primary">ログインへ</UiLinkButton></> :
        <form onSubmit={create}>
          <UiField label="プロジェクト名" required><UiInput name="title" required minLength={3} maxLength={240} /></UiField>
          <UiField label="概要"><UiTextarea name="description" maxLength={5000} rows={5} /></UiField>
          <UiField label="公開範囲"><UiSelect name="visibility" defaultValue="public">{RESEARCH_VISIBILITIES.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}</UiSelect></UiField>
          <UiField label="既定ライセンス" hint="成果ごとに上書きできます。"><UiInput name="defaultLicense" placeholder="例: CC BY 4.0" maxLength={200} /></UiField>
          {message ? <p role="alert" className="research-error">{message}</p> : null}
          <UiButton tone="primary" pending={pending} pendingLabel="作成中…">プロジェクトを作成</UiButton>
        </form>}
      </details>
    </div>
    <ResearchGitHub />
  </section>;
}

function ResearchProjectList(props:{projects:ResearchProject[];signedIn:boolean;unavailable:boolean;basePath:string;v2?:boolean;onCreate?:()=>void;githubOpen?:boolean;onGithub?:()=>void}){
  const identity=useRef({previous:props.signedIn,changed:false}),[account,setAccount]=useState(0);
  identity.current.changed ||= identity.current.previous!==props.signedIn;identity.current.previous=props.signedIn;
  useEffect(()=>{const clear=()=>setAccount(value=>value+1);window.addEventListener('hub-account-changed',clear);return()=>window.removeEventListener('hub-account-changed',clear);},[]);
  const trusted=account===0&&!identity.current.changed;
  return <ResearchProjectSearch key={JSON.stringify([account,props.signedIn])} {...props} initialTrusted={trusted}/>;
}
type ProjectPage={projects:ResearchProject[];limit:30;offset:number;hasMore:boolean};
function projectPage(value:unknown,offset:number):ProjectPage{
  const page=value as Partial<ProjectPage>|null;
  if(!page||page.limit!==30||page.offset!==offset||typeof page.hasMore!=='boolean'||!Array.isArray(page.projects)||page.projects.length>30||page.hasMore&&page.projects.length!==30)throw Error('研究一覧の応答が検索・ページと一致しません。');
  if(page.projects.some(project=>!project||typeof project.id!=='string'||!/^rp_[a-f0-9]{32}$/.test(project.id)||typeof project.title!=='string'||project.title.length>240||typeof project.description!=='string'||project.description.length>5000||!RESEARCH_VISIBILITIES.includes(project.visibility)||!Object.hasOwn(statusLabels,project.status)||typeof project.updatedAt!=='string'||!Number.isFinite(Date.parse(project.updatedAt))||!Number.isSafeInteger(project.objectCount)||project.objectCount<0)||new Set(page.projects.map(project=>project.id)).size!==page.projects.length)throw Error('研究一覧の内容を確認できません。');
  return page as ProjectPage;
}
function ResearchProjectSearch({projects,signedIn,unavailable,basePath,initialTrusted,v2=false,onCreate,githubOpen=false,onGithub}:{projects:ResearchProject[];signedIn:boolean;unavailable:boolean;basePath:string;initialTrusted:boolean;v2?:boolean;onCreate?:()=>void;githubOpen?:boolean;onGithub?:()=>void}){
  const [draft,setDraft]=useState(''),[applied,setApplied]=useState({query:'',source:'all',revision:0}),[inputError,setInputError]=useState('');
  const scope=JSON.stringify(applied),localSelected=applied.source==='all'||applied.source==='primary';
  const [local,setLocal]=useState({scope,projects:initialTrusted&&!unavailable?projects:[],nextOffset:projects.length,hasMore:initialTrusted&&!unavailable&&projects.length===100,loading:false,error:initialTrusted&&unavailable?'研究プロジェクトを読み込めませんでした':''});
  const network=useHubNetwork('research',signedIn,{query:applied.query,source:applied.source});
  const life=useRef({mounted:true,serial:0,busy:false,controller:null as AbortController|null}),currentScope=useRef(scope);currentScope.current=scope;
  const visible=localSelected&&local.scope===scope?local:{scope,projects:[] as ResearchProject[],nextOffset:0,hasMore:false,loading:localSelected,error:''};
  useEffect(()=>{life.current.mounted=true;const clear=()=>{life.current.serial++;life.current.controller?.abort();setLocal({scope:'',projects:[],nextOffset:0,hasMore:false,loading:false,error:''});};window.addEventListener('hub-account-changed',clear);return()=>{life.current.mounted=false;life.current.serial++;life.current.controller?.abort();window.removeEventListener('hub-account-changed',clear);};},[]);
  async function readPage(offset=0,append=false){
    const state=life.current;if(append&&state.busy)return;state.controller?.abort();const controller=new AbortController(),serial=++state.serial;state.controller=controller;state.busy=true;
    setLocal(previous=>({scope,projects:append&&previous.scope===scope?previous.projects:[],nextOffset:offset,hasMore:append&&previous.scope===scope&&previous.hasMore,loading:true,error:''}));
    try{
      const response=await fetch(`/api/research/projects?q=${encodeURIComponent(applied.query)}&limit=30&offset=${offset}`,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(!response.ok)throw Error('このHubの研究一覧を読み込めませんでした。');
      const page=projectPage(await response.json(),offset);if(!state.mounted||serial!==state.serial||controller.signal.aborted||currentScope.current!==scope)return;
      setLocal(previous=>({scope,projects:append&&previous.scope===scope?[...new Map([...previous.projects,...page.projects].map(project=>[project.id,project])).values()]:page.projects,nextOffset:offset+30,hasMore:page.hasMore,loading:false,error:''}));
    }catch(e){if(state.mounted&&serial===state.serial&&!controller.signal.aborted&&currentScope.current===scope)setLocal(previous=>({...previous,scope,loading:false,error:e instanceof Error?e.message:'このHubの研究一覧を読み込めませんでした。'}));}
    finally{if(state.mounted&&serial===state.serial){state.busy=false;state.controller=null;}}
  }
  useEffect(()=>{life.current.busy=false;life.current.controller?.abort();if(localSelected&&(!initialTrusted||applied.revision>0))void readPage();else if(!localSelected)setLocal({scope,projects:[],nextOffset:0,hasMore:false,loading:false,error:''});return()=>{life.current.serial++;life.current.controller?.abort();};},[scope]);
  function search(event:FormEvent){event.preventDefault();try{const query=hubCatalogResearchQuery(draft);setInputError('');setApplied(value=>({...value,query,revision:value.revision+1}));if(query===applied.query)network.retry();}catch{setInputError('検索は100文字以内・8語以内で、制御文字を含めず入力してください。');}}
  const sourceLabel=applied.source==='all'?'このHubと接続Hub':applied.source==='primary'?'このHub':applied.source;
  const empty=!visible.loading&&!network.loading&&!visible.error&&!network.error&&!network.failed.length&&!visible.projects.length&&!network.items.length;
  if(v2){
    const sourceSelect=<select className="v2-rl-source" aria-label="研究の表示元" value={applied.source} onChange={event=>{setInputError('');setApplied(value=>({...value,source:event.target.value,revision:value.revision+1}));}}><option value="all">このHubと接続Hub</option><option value="primary">このHub</option>{network.origins.map(origin=><option key={origin} value={origin}>{origin}</option>)}{!['all','primary'].includes(applied.source)&&!network.origins.includes(applied.source)?<option value={applied.source}>{applied.source}（確認中）</option>:null}</select>;
    const total=visible.projects.length+network.items.length;
    return <div className="v2-rl-list">
      <form className="v2-search__form v2-rl-search" role="search" aria-label="研究検索" onSubmit={search}>
        <input type="search" aria-label="プロジェクトを検索" value={draft} maxLength={100} onChange={event=>setDraft(event.target.value)} placeholder="名前・概要を検索"/>
        {sourceSelect}
        <button type="submit" className="v2-search__submit">検索</button>
        {onGithub?<button type="button" className="v2-search__submit" aria-expanded={githubOpen} onClick={onGithub}>GitHubを確認</button>:null}
        {applied.query||applied.source!=='all'?<button type="button" className="v2-search__submit" onClick={()=>{setDraft('');setInputError('');setApplied(value=>({query:'',source:'all',revision:value.revision+1}));if(!applied.query&&applied.source==='all')network.retry();}}>戻す</button>:null}
      </form>
      {inputError?<p role="alert" className="research-error">{inputError}</p>:null}
      <HubNetworkStatus state={network}/>{network.loading?<p role="status" className="v2-rl-note">接続Hubを読み込み中…</p>:null}{network.error||network.failed.length?<button type="button" className="v2-search__submit" onClick={network.retry}>接続Hubを再試行</button>:null}
      {visible.error?<UiStatePanel state="error" title="研究プロジェクトを読み込めませんでした" description={visible.error} action={<><UiButton type="button" size="compact" onClick={()=>void readPage(visible.projects.length?visible.nextOffset:0,visible.projects.length>0)}>再試行</UiButton></>}/>:null}
      {total>0?<p className="v2-rl-count" aria-live="polite">{total}件</p>:null}
      <div className="v2-rl-grid">
        {visible.projects.map(project=><a className="research-project-card v2-rl-card" data-hub-origin="primary" href={`${basePath}/${encodeURIComponent(project.id)}`} key={`primary:${project.id}`}><div><span>{visibilityLabels[project.visibility]}</span><span>{statusLabels[project.status]??project.status}</span></div><h3>{project.title}</h3><p>{project.description||'説明はまだありません。'}</p><footer><strong>{project.objectCount} 成果</strong><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString('ja-JP')}</time></footer></a>)}
        {network.items.map(item=><HubNetworkCard key={`${item.origin}:${item.id}`} item={item}/>)}
      </div>
      {empty?(applied.query?<V2Empty title="一致するプロジェクトはありません"/>:<V2Empty title="プロジェクトはまだありません" action={onCreate?{label:'新しいプロジェクト',onClick:onCreate}:undefined}/>):null}
      {visible.loading?<p role="status" className="v2-rl-note">読み込み中…</p>:null}{visible.hasMore?<button type="button" className="v2-search__submit" disabled={visible.loading} onClick={()=>void readPage(visible.nextOffset,true)}>さらに30件</button>:null}
    </div>;
  }
  return <section aria-labelledby="projects-title" style={{minWidth:0,overflowWrap:'anywhere'}}>
    <div className="research-section-heading"><div><h2 id="projects-title">プロジェクト</h2><p>このHubの公開研究と自分の非公開研究、接続Hubの公開研究を検索します。</p></div><strong>{visible.projects.length+network.items.length}件</strong></div>
    <form aria-label="研究検索" onSubmit={search}><UiField label="プロジェクトを検索"><UiInput aria-label="プロジェクトを検索" type="search" value={draft} maxLength={100} onChange={event=>setDraft(event.target.value)} placeholder="名前・概要を検索"/></UiField>
      <UiField label="表示元"><UiSelect aria-label="研究の表示元" value={applied.source} onChange={event=>{setInputError('');setApplied(value=>({...value,source:event.target.value,revision:value.revision+1}));}}><option value="all">このHubと接続Hub</option><option value="primary">このHub</option>{network.origins.map(origin=><option key={origin} value={origin}>{origin}</option>)}{!['all','primary'].includes(applied.source)&&!network.origins.includes(applied.source)?<option value={applied.source}>{applied.source}（確認中）</option>:null}</UiSelect></UiField>
      <UiButton type="submit" size="compact">研究を検索</UiButton>{applied.query||applied.source!=='all'?<UiButton type="button" size="compact" onClick={()=>{setDraft('');setInputError('');setApplied(value=>({query:'',source:'all',revision:value.revision+1}));if(!applied.query&&applied.source==='all')network.retry();}}>検索を戻す</UiButton>:null}
    </form>
    <p>検索語: {applied.query||'指定なし'} · 表示元: {sourceLabel}。検索を押した言葉だけを、選択した接続Hubへ送ります。</p>
    {inputError?<p role="alert" className="research-error">{inputError}</p>:null}
    <HubNetworkStatus state={network}/>{network.loading?<p role="status">接続Hubの研究を読み込んでいます…</p>:null}{network.error||network.failed.length?<UiButton type="button" size="compact" onClick={network.retry}>接続Hubを再試行</UiButton>:null}
    <div className="research-project-grid">
      {visible.error?<UiStatePanel state="error" title="研究プロジェクトを読み込めませんでした" description={visible.error} action={<><UiButton type="button" size="compact" onClick={()=>void readPage(visible.projects.length?visible.nextOffset:0,visible.projects.length>0)}>このHubを再試行</UiButton><UiLinkButton href={basePath}>再読み込み</UiLinkButton></>}/>:null}
      {visible.projects.map(project=><a className="research-project-card" data-hub-origin="primary" href={`${basePath}/${encodeURIComponent(project.id)}`} key={`primary:${project.id}`}><small>このHub</small><div><span>{visibilityLabels[project.visibility]}</span><span>{statusLabels[project.status]??project.status}</span></div><h3>{project.title}</h3><p>{project.description||'説明はまだありません。'}</p><footer><strong>{project.objectCount} 成果</strong><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString('ja-JP')}</time></footer></a>)}
      {network.items.map(item=><HubNetworkCard key={`${item.origin}:${item.id}`} item={item}/>)}
      {empty?<UiStatePanel state="empty" title={applied.query?'検索に一致するプロジェクトはありません':'表示できる研究はまだありません'} description={applied.query?'名前や概要の別の言葉で検索してください。':'最初の研究プロジェクトを作成できます。'}/>:null}
    </div>
    {visible.loading?<p role="status">このHubの研究を読み込んでいます…</p>:null}{visible.hasMore?<UiButton type="button" size="compact" disabled={visible.loading} onClick={()=>void readPage(visible.nextOffset,true)}>このHubの研究をさらに30件表示</UiButton>:null}
  </section>;
}

export function ResearchProjectUnavailable({ basePath = DEFAULT_RESEARCH_BASE }: { basePath?: string } = {}) {
  return <section className="research-page">
    <UiStatePanel
      state="error"
      title="研究プロジェクトへ接続できませんでした"
      description="一時的な障害の可能性があります。再読み込みしても続く場合は、研究一覧へ戻ってください。"
      action={<div className="research-state-actions">
        <UiLinkButton href="">再読み込み</UiLinkButton>
        <UiLinkButton href={basePath}>研究一覧へ</UiLinkButton>
      </div>}
    />
  </section>;
}

export function ResearchProjectWorkspace({
  project,
  objects,
  relations,
  canEdit,
  signedIn = canEdit,
  viewerId,
  initialDocument = '',
  initialVersion = '',
  initialCommit = '',
  initialBase = '',
  initialGitProposal = '',
  unavailable = false,
  basePath = DEFAULT_RESEARCH_BASE,
  showNavigation = true,
}: {
  project: ResearchProject;
  objects: ResearchObject[];
  relations: ResearchRelation[];
  canEdit: boolean;
  signedIn?: boolean;
  viewerId?: string;
  initialDocument?: string;
  initialVersion?: string;
  initialCommit?: string;
  initialBase?: string;
  initialGitProposal?: string;
  unavailable?: boolean;
  basePath?: string;
  showNavigation?: boolean;
}) {
  const [objectMessage, setObjectMessage] = useState("");
  const [relationMessage, setRelationMessage] = useState("");
  const [objectPending, setObjectPending] = useState(false);
  const [relationPending, setRelationPending] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const group = objectGroups.find((item) => item.id === selectedGroup)!;
  const visibleObjects = objects.filter((object) => group.id === "all" || group.types.includes(object.objectType));
  async function createObject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setObjectPending(true); setObjectMessage("");
    try {
      await submitJson(`/api/research/projects/${encodeURIComponent(project.id)}/objects`, Object.fromEntries(new FormData(event.currentTarget)));
      location.reload();
    } catch (cause) {
      setObjectMessage(cause instanceof Error ? cause.message : "登録できませんでした。");
    } finally {
      setObjectPending(false);
    }
  }
  async function createRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setRelationPending(true); setRelationMessage("");
    try {
      await submitJson(`/api/research/projects/${encodeURIComponent(project.id)}/relations`, Object.fromEntries(new FormData(event.currentTarget)));
      location.reload();
    } catch (cause) {
      setRelationMessage(cause instanceof Error ? cause.message : "登録できませんでした。");
    } finally {
      setRelationPending(false);
    }
  }
  const byId = new Map(objects.map((object) => [object.id, object]));
  return <section className="research-page">
    <header className="research-project-header" id="overview">
      <a href={basePath}>← 研究</a><div><span>{visibilityLabels[project.visibility]}</span><span>{statusLabels[project.status] ?? project.status}</span></div>
      <h1>{project.title}</h1><p>{project.description || "説明はまだありません。"}</p>
    </header>
    <ResearchFork key={JSON.stringify(['fork',project.id,viewerId??(signedIn?'signed-in':'anonymous')])} projectId={project.id} signedIn={signedIn} basePath={basePath}/>
    {showNavigation ? <nav className="research-local-nav" aria-label="プロジェクト内"><a href="#workspace">文書・コード</a><a href="#references">資料・作品・議論</a><a href="#pdfs">PDF</a><a href="#git">Git</a><a href="#github">GitHub</a><a href="#objects">成果情報</a><a href="#relations">主張と根拠</a>{canEdit ? <a href="#register">登録</a> : null}</nav> : null}
    <ResearchDocuments key={JSON.stringify([project.id,viewerId ?? (signedIn ? 'signed-in' : 'anonymous')])} projectId={project.id} viewerId={viewerId} canEdit={canEdit} signedIn={signedIn} initialDocument={initialDocument} initialVersion={initialVersion} initialCommit={initialCommit} initialBase={initialBase} initialGitProposal={initialGitProposal} projectPublic={project.visibility === 'public' && project.status !== 'withdrawn'}/>
    {unavailable ? <UiStatePanel
      state="error"
      title="研究成果を読み込めませんでした"
      description="プロジェクト情報は表示できていますが、成果と関係の一覧は一時的に利用できません。"
      action={<UiLinkButton href={`${basePath}/${encodeURIComponent(project.id)}`}>再読み込み</UiLinkButton>}
    /> : null}
    <ResearchGitHub />
    <section id="objects">
      <div className="research-section-heading"><div><h2>研究成果</h2><p>本文やファイルではなく、種類・版・ハッシュ・公開範囲を管理します。</p></div><strong>{visibleObjects.length}件</strong></div>
      <div className="research-local-nav research-filters" role="group" aria-label="成果の種類">{objectGroups.map((item) => <UiButton key={item.id} type="button" aria-pressed={selectedGroup === item.id} onClick={() => setSelectedGroup(item.id)}>{item.label}</UiButton>)}</div>
      <div className="research-object-list">{visibleObjects.map((object) => <article key={object.id}>
        <span>{typeLabels[object.objectType]}</span><div><h3>{object.title}</h3><p>第{object.version}版 · {visibilityLabels[object.visibility]} · {statusLabels[object.reviewStatus] ?? object.reviewStatus}</p><p>ライセンス: {object.license || "未設定"}</p></div>
        <code title={object.contentHash}>{object.contentHash.slice(0, 20)}…</code>
      </article>)}{!unavailable && !objects.length ? <V2Empty title="研究成果はまだありません" note="主張だけでなく、根拠や手順も独立した成果として登録します。" /> : null}</div>
      {!unavailable && objects.length > 0 && !visibleObjects.length ? <UiStatePanel state="empty" title="この種類の成果はまだありません" description="別の種類を選ぶと、登録済みの成果を確認できます。" /> : null}
    </section>
    <section id="relations">
      <div className="research-section-heading"><div><h2>主張と根拠の関係</h2><p>支持、反証、再現、派生を同じ一覧で追跡します。</p></div><strong>{relations.length}件</strong></div>
      <div className="research-relation-list">{relations.map((relation) => <article key={`${relation.fromObjectId}:${relation.toObjectId}:${relation.relationType}`}>
        <strong>{byId.get(relation.fromObjectId)?.title ?? relation.fromObjectId}</strong><span>{relationLabels[relation.relationType]}</span><strong>{byId.get(relation.toObjectId)?.title ?? relation.toObjectId}</strong>
      </article>)}{!unavailable && !relations.length ? <V2Empty title="関係はまだ登録されていません" note="成果を2件以上登録すると、検証関係を追加できます。" /> : null}</div>
    </section>
    {canEdit ? <section id="register" className="research-editor-grid">
      <form onSubmit={createObject}><h2>成果を登録</h2>
        <UiField label="種類"><UiSelect name="objectType">{RESEARCH_OBJECT_TYPES.map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}</UiSelect></UiField>
        <UiField label="タイトル" required><UiInput name="title" required maxLength={240} /></UiField>
        <UiField label="版" required><UiInput name="version" type="number" min={1} defaultValue={1} required /></UiField>
        <UiField label="SHA-256" required hint="sha256: に続けて64桁の小文字16進数を入力します。"><UiInput name="contentHash" required pattern="sha256:[a-f0-9]{64}" placeholder="sha256:…" /></UiField>
        <UiField label="公開範囲"><UiSelect name="visibility" defaultValue={project.visibility}>{RESEARCH_VISIBILITIES.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}</UiSelect></UiField>
        <UiField label="ライセンス"><UiInput name="license" defaultValue={project.defaultLicense ?? ""} maxLength={200} /></UiField>
        {objectMessage ? <p role="alert" className="research-error">{objectMessage}</p> : null}
        <UiButton tone="primary" pending={objectPending} pendingLabel="保存中…">成果を登録</UiButton>
      </form>
      <form onSubmit={createRelation}><h2>関係を登録</h2>
        <UiField label="起点" required><UiSelect name="fromObjectId" required><option value="">選択</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.title}</option>)}</UiSelect></UiField>
        <UiField label="関係"><UiSelect name="relationType">{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</UiSelect></UiField>
        <UiField label="対象" required><UiSelect name="toObjectId" required><option value="">選択</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.title}</option>)}</UiSelect></UiField>
        <p>起点と対象には別の成果を選んでください。</p>
        {relationMessage ? <p role="alert" className="research-error">{relationMessage}</p> : null}
        <UiButton tone="primary" pending={relationPending} disabled={objects.length < 2}>関係を登録</UiButton>
      </form>
    </section> : null}
  </section>;
}
