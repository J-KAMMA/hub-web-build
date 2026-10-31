'use client';

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {hubCatalogResearchQuery,normalizeHubOrigin, readHubCatalog, type HubNetworkItem, type HubNetworkKind} from '@/lib/hub-network-client';
import styles from './hub-network.module.css';
import {readPeerPostCatalog} from '@/lib/hub-peer-browser';
import {PublicPostPeerSettings} from './public-post-peer-settings';
import {ResearchForkDownload} from './research-fork-download';
import {ResearchFork} from './research-fork';
import {contentShareReference} from '@/lib/content-share';
import {V2ContentShare} from './v2/v2-content-share';

const changed = 'hub-network-changed';
class TransientHubSourcesError extends Error {}
async function sources(signal?:AbortSignal):Promise<string[]> {
  let response:Response;
  try {response=await fetch('/api/network/sources',{cache:'no-store', credentials:'same-origin', signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});}
  catch {throw new TransientHubSourcesError();}
  if(response.status>=500&&response.status<=599)throw new TransientHubSourcesError();
  if(response.status!==200) throw Error('接続先を確認できませんでした。');
  const body=await response.json();
  if(!body || !Array.isArray(body.sources) || body.sources.length>8) throw Error('接続先を確認できませんでした。');
  return [...new Set(body.sources.map(normalizeHubOrigin))].filter(origin=>origin!==window.location.origin) as string[];
}

type NetworkOptions={query?:string;source?:string};
const emptyNetwork={items:[] as HubNetworkItem[],failed:[] as string[],error:'',notice:'',count:0,origins:[] as string[],loading:false};
export function useHubNetwork(kind:HubNetworkKind, enabled=true,options:NetworkOptions={}) {
  const query=options.query??'',source=options.source??'all',scope=JSON.stringify([kind,enabled,query,source]);
  const [state,setState]=useState({...emptyNetwork,scope}),[revision,setRevision]=useState(0);
  const knownOrigins=useRef<{scope:string;origins:string[]}|null>(null);
  const retry=useCallback(()=>{setState({...emptyNetwork,scope:''});setRevision(value=>value+1);},[]);
  useEffect(()=>()=>{knownOrigins.current=null;},[]);
  useEffect(()=>{
    if(!enabled||knownOrigins.current?.scope!==scope)knownOrigins.current=null;
    if(!enabled) {setState({...emptyNetwork,scope});return;}
    let controller:AbortController|undefined;
    const load=async()=>{
      controller?.abort(); controller=new AbortController(); const signal=controller.signal;
      // Clear on refresh too: data from a signed-out profile must not linger.
      setState({...emptyNetwork,scope,loading:true});
      try {
        const normalized=kind==='research'?hubCatalogResearchQuery(query):'';
        let origins:string[],notice='';
        try {
          origins=await sources(signal);
          if(signal.aborted)return;
          knownOrigins.current={scope,origins};
        } catch(error) {
          if(signal.aborted)return;
          if(!(error instanceof TransientHubSourcesError)||knownOrigins.current?.scope!==scope){knownOrigins.current=null;throw error;}
          origins=[...knownOrigins.current.origins];
          notice='接続先一覧を一時的に確認できません。以前確認したHubの公開内容だけを読み直して表示します。';
        }
        if(signal.aborted)return;
        const selected=source==='all'?origins:source==='primary'?[]:origins.filter(origin=>origin===source);
        if(source!=='all'&&source!=='primary'&&!selected.length){setState({...emptyNetwork,scope,origins,error:'選択したHubは現在の接続先に含まれていません。'});return;}
        setState({...emptyNetwork,scope,origins,count:selected.length,loading:true,notice});
        const results=await Promise.allSettled(selected.map(origin=>notice?readHubCatalog(origin,kind,signal,normalized):kind==='post'?readPeerPostCatalog(origin,signal):normalized?readHubCatalog(origin,kind,signal,normalized):readHubCatalog(origin,kind,signal)));
        if(signal.aborted) return;
        const rejected=new Set(results.flatMap((r,i)=>r.status==='rejected'?[selected[i]]:[]));
        knownOrigins.current={scope,origins:origins.filter(origin=>!rejected.has(origin))};
        setState({scope,origins,loading:false,count:selected.length,error:'',notice,items:results.flatMap(r=>r.status==='fulfilled'?r.value:[]),failed:results.flatMap((r,i)=>r.status==='rejected'?[new URL(selected[i]).host]:[])});
      } catch {if(!signal.aborted)setState({...emptyNetwork,scope,error:'接続先と検索条件を確認できませんでした。'});}
    };
    const refresh=()=>{if(document.visibilityState!=='hidden')void load();};
    const invalidate=()=>{knownOrigins.current=null;controller?.abort();setState({...emptyNetwork,scope});};
    const connections=()=>{invalidate();refresh();};
    const account=()=>{invalidate();if(!query)void load();};
    void load();window.addEventListener(changed,connections);window.addEventListener('hub-account-changed',account);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return ()=>{controller?.abort();window.removeEventListener(changed,connections);window.removeEventListener('hub-account-changed',account);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[kind,enabled,query,source,revision]);
  return {...(enabled&&state.scope===scope?state:{...emptyNetwork,loading:enabled}),retry};
}

export function HubNetworkStatus({state}:{state:ReturnType<typeof useHubNetwork>}) {
  if(!state.count && !state.error && !state.notice) return null;
  return <p className={styles.status} role="status">{state.notice}{state.notice?' ':''}{state.error || (state.failed.length ? `${state.failed.join('、')} に接続できません。ほかのHubの内容を表示しています。` : `${state.count}件の接続先を含めて表示`)} <a href="/v2/settings#hub-connections">接続先</a></p>;
}

export function HubNetworkCard({item}:{item:HubNetworkItem}) {
  let host='接続先不明',href:string|null=null;
  try {
    const origin=normalizeHubOrigin(item.origin);
    if(origin===item.origin) {
      host=new URL(origin).host;
      const reference=contentShareReference(item.origin+item.path);
      const path=reference?.kind==='post'?`/v2/posts/${item.id}`:reference?.kind==='project'?`/v2/research/${item.id}`:null;
      if(/^[A-Za-z0-9_-]{1,128}$/.test(item.id)&&item.path===path&&reference?.href===item.origin+item.path)href=reference.href;
    }
  } catch {}
  return <article className={styles.card} data-hub-origin={item.origin}>
    <small>{host}</small>
    {href?<a href={href} target="_blank" rel="noopener noreferrer" className={styles.title}>{item.title || '公開された内容'} <span aria-label="別のHubで開く">↗</span></a>:<span className={styles.title}>{item.title || '公開された内容'}</span>}
    <p>{item.summary}</p>
    {href?<V2ContentShare href={item.origin+item.path}/>:null}
    {href&&item.id.length===35&&/^rp_[a-f0-9]{32}$/.test(item.id)&&item.path===`/v2/research/${item.id}`?<><ConnectedResearchFork item={item}/><ResearchForkDownload origin={item.origin} projectId={item.id}/></>:null}
  </article>;
}
function ConnectedResearchFork({item}:{item:HubNetworkItem}) {
  const [opened,setOpened]=useState(false);
  return <details onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary>自分のHubへfork</summary>
    {opened?<ResearchFork key={item.origin+item.id} projectId={item.id} signedIn basePath="/v2/research" remoteOrigin={item.origin}/>:null}
  </details>;
}

export function HubNetworkSettings() {
  const [origins,setOrigins]=useState<string[]>([]), [url,setUrl]=useState(''), [message,setMessage]=useState(''), [busy,setBusy]=useState(true), [login,setLogin]=useState(false), [ready,setReady]=useState(false), [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setReady(false);setLogin(false);
    void fetch('/api/network/sources',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}).then(async r=>{
      if(r.status===401) {setLogin(true);return;}
      if(!r.ok) throw Error();
      const body=await r.json();setOrigins(body.sources.map(normalizeHubOrigin));setReady(true);setMessage('');
    }).catch(()=>{if(!controller.signal.aborted)setMessage('接続先を読み込めませんでした。');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[retry]);
  async function save(action:'add'|'remove', raw:string) {
    if(busy || !ready) return;
    setBusy(true);setMessage('');
    try {
      const origin=normalizeHubOrigin(raw);
      if(action==='add') {
        if(origin===window.location.origin || origins.includes(origin)) throw Error('このHubはすでに接続先に含まれています。');
        if(origins.length>=8) throw Error('追加するHubは8件までです。');
        setMessage('Hubの公開一覧を確認しています…');await readHubCatalog(origin,'post');
      }
      const response=await fetch('/api/network/sources',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,origin}),signal:AbortSignal.timeout(10000)});
      const body=await response.json();if(!response.ok) throw Error(body.error || '保存できませんでした。');
      setOrigins(body.sources);setUrl('');setMessage(action==='add'?'追加しました。SNSとマーケットに自動で表示します。':'接続先から外しました。');window.dispatchEvent(new Event(changed));
    } catch(error) {setMessage(error instanceof Error?error.message:'接続できませんでした。');} finally {setBusy(false);}
  }
  return <><section id="hub-connections" className={styles.settings} aria-labelledby="hub-connections-title">
    <h3 id="hub-connections-title">接続するHub</h3>
    <p>追加したHubの公開投稿・商品を、いつものSNS・マーケットでまとめて読めます。同じHubプロフィールでログインした端末に接続先を引き継ぎます。</p>
    <p className={styles.status}>取得時に接続先へIPアドレスが伝わります。ログイン情報は送りません。投稿・購入などは元のHubで行います。</p>
    {login?<a href="/v2/auth?next=%2Fv2%2Fsettings%23hub-connections">Hubにログイン</a>:<>
      <form onSubmit={event=>{event.preventDefault();void save('add',url);}}>
        <label htmlFor="hub-connection-url">HubのURL</label>
        <div className={styles.inputRow}><input id="hub-connection-url" type="url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://community.example" required maxLength={512} disabled={busy||!ready}/><button type="submit" disabled={busy||!ready||origins.length>=8}>追加</button></div>
      </form>
      <ul>{origins.map(origin=><li key={origin}><span>{new URL(origin).host}</span><button type="button" disabled={busy} onClick={()=>void save('remove',origin)}>外す</button></li>)}</ul>
      {!busy&&!ready?<button type="button" onClick={()=>setRetry(n=>n+1)}>再試行</button>:null}
    </>}
    <p role="status">{busy&&!ready?'接続先を読み込んでいます…':message}</p>
  </section><PublicPostPeerSettings/></>;
}
