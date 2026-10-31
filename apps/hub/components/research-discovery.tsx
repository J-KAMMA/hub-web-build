'use client';
import React,{useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {researchLinkLabels,type ResearchLinkKind} from '@/lib/research-workspace';
import {checkedResearchDiscovery,researchDiscoverySource,type ResearchDiscoveryItem,type ResearchSourceContext} from '@/lib/research-discovery';
import {UiButton} from './ui/primitives';

const collapseKey='hub.feedUpdatesCollapsed';
type Props={kind?:ResearchLinkKind;targetId?:string;sourceContext?:ResearchSourceContext};
type State={phase:'loading'|'data'|'error';items:ResearchDiscoveryItem[]};
export function ResearchDiscovery(props:Props){
  const [account,setAccount]=useState(0);
  useEffect(()=>{const clear=()=>setAccount(value=>value+1);window.addEventListener('hub-account-changed',clear);return()=>window.removeEventListener('hub-account-changed',clear);},[]);
  return <DiscoveryScope key={JSON.stringify([account,props.kind,props.targetId])} {...props}/>;
}
function DiscoveryScope({kind,targetId,sourceContext}:Props){
  const [state,setState]=useState<State>({phase:'loading',items:[]}),life=useRef({mounted:true,generation:0,busy:false,controller:null as AbortController|null});
  const related=Boolean(kind&&targetId),heading=related?`${researchLinkLabels[kind!]}に関連する研究`:'作品・研究の更新';
  const source=related?researchDiscoverySource(kind,targetId,sourceContext):null;
  async function load(){
    const current=life.current;if(current.busy||!current.mounted)return;const controller=new AbortController(),generation=++current.generation;current.controller?.abort();current.controller=controller;current.busy=true;setState({phase:'loading',items:[]});
    const valid=()=>current.mounted&&current.generation===generation&&!controller.signal.aborted;
    try{
      if(related&&(!Object.hasOwn(researchLinkLabels,kind!)||typeof targetId!=='string'||!targetId.trim()||targetId.length>240||/[\u0000-\u001f\u007f-\u009f]/u.test(targetId)))throw Error();
      const endpoint=`/api/research/discovery${related?`?kind=${kind}&id=${encodeURIComponent(targetId!)}`:''}`;
      const response=await fetch(endpoint,{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(!response.ok)throw Error();const items=checkedResearchDiscovery(await response.json(),related);
      if(valid())setState({phase:'data',items});
    }catch{if(valid())setState({phase:'error',items:[]});}
    finally{if(current.mounted&&current.generation===generation){current.busy=false;current.controller=null;}}
  }
  useEffect(()=>{const current=life.current;current.mounted=true;const clear=()=>{current.generation++;current.controller?.abort();current.busy=false;setState({phase:'loading',items:[]});};window.addEventListener('hub-account-changed',clear);void load();return()=>{current.mounted=false;current.generation++;current.controller?.abort();current.controller=null;current.busy=false;window.removeEventListener('hub-account-changed',clear);};},[]);
  const [collapsed,setCollapsed]=useState(false),[expanded,setExpanded]=useState(false);
  useEffect(()=>{try{if(window.localStorage.getItem(collapseKey)==='1')setCollapsed(true);}catch{}},[]);
  function toggleCollapsed(){const next=!collapsed;setCollapsed(next);try{if(next)window.localStorage.setItem(collapseKey,'1');else window.localStorage.removeItem(collapseKey);}catch{}}
  if(state.phase==='data'&&!state.items.length)return null;
  const compact=!related,limit=5,total=state.items.length,visible=compact&&!expanded?state.items.slice(0,limit):state.items,listId=`research-discovery-list-${heading.length}`;
  const label=(item:ResearchDiscoveryItem)=>item.projectTitle?`${item.projectTitle} · v${item.version}`:({article:'記事',video:'動画',music:'音楽作品'} as Record<string,string>)[item.kind??''];
  const hidden=compact&&collapsed&&state.phase==='data';
  return <section className={compact?'research-discovery research-discovery-compact':'research-discovery'} aria-label={heading}>
    {compact?<div className="research-discovery-head"><h3>{heading}</h3>{state.phase==='data'?<button type="button" className="research-discovery-toggle" aria-expanded={!collapsed} aria-controls={listId} onClick={toggleCollapsed}>{collapsed?'表示する':'折りたたむ'}</button>:null}</div>:<h3>{heading}</h3>}
    {related?<p className="research-discovery-description">関連するプロジェクトから、資料・コード・版履歴・変更提案へ進めます。</p>:null}
    {state.phase==='loading'?<p role="status">研究の表示を読み込んでいます…</p>:null}
    {state.phase==='error'?<><p role="alert">関連する研究を読み込めませんでした。</p><UiButton type="button" size="compact" onClick={()=>void load()}>研究の表示を再試行</UiButton></>:null}
    {hidden?null:<div id={listId} className={compact?'research-discovery-list':undefined}>
      {visible.map(item=><Link key={`${item.kind??'project'}:${item.href}`} href={source?`${item.href}?from=${encodeURIComponent(source.href)}`:item.href} title={compact?item.title:undefined}><strong>{item.title}</strong><span className={compact?'research-discovery-kind':undefined}>{label(item)}</span></Link>)}
      {compact&&total>limit?<button type="button" className="research-discovery-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'閉じる':`すべて見る（${total}件）`}</button>:null}
    </div>}
    <Link href="/v2/research">研究一覧へ</Link>
  </section>;
}
