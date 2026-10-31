'use client';
import React,{useEffect,useRef,useState} from 'react';
import {UiButton,UiInput} from './ui/primitives';
import {P2PTransferPanel} from './p2p-transfer-panel';
import {parseResearchChangePackage,RESEARCH_CHANGE_BYTES} from '@/lib/research-change-package';
import {researchForkDigest} from '@/lib/research-fork-package';
import {PAIRING_RELAY_ORIGIN} from '@/lib/p2p-pairing.mjs';
import type {ResearchForkSource} from '@/lib/server/research-fork';

export function ResearchForkChangeExport({projectId,documentId,body}:{projectId:string;documentId:string;body:string}){
  const life=useRef(0);
  const [source,setSource]=useState<ResearchForkSource|null>(null),[summary,setSummary]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [saved,setSaved]=useState<{url:string;file:File;origin:string;projectId:string;documentId:string}|null>(null),[peer,setPeer]=useState(false);
  useEffect(()=>{const abort=new AbortController();setSource(null);setSaved(null);setSummary('');setBusy(false);setError('');
    const invalidate=()=>{life.current++;abort.abort();setSource(null);setSaved(null);setPeer(false);setSummary('');setError('');setBusy(false);};window.addEventListener('hub-account-changed',invalidate);
    void fetch(`/api/research/projects/${encodeURIComponent(projectId)}/fork`,{cache:'no-store',signal:abort.signal}).then(async r=>{if(!r.ok)return;const v=await r.json();if(!abort.signal.aborted)setSource(v.source??null);}).catch(()=>{});
    return()=>{life.current++;abort.abort();window.removeEventListener('hub-account-changed',invalidate);};
  },[projectId,documentId]);
  useEffect(()=>{life.current++;setSaved(null);setPeer(false);setBusy(false);},[body]);
  useEffect(()=>()=>{if(saved)URL.revokeObjectURL(saved.url);},[saved]);
  const original=source?.documents.find(d=>d.documentId===documentId);
  if(!original)return null;
  async function prepare(){
    if(busy||!source||!original)return;const generation=life.current;setBusy(true);setError('');setSaved(null);setPeer(false);
    try{const targetOrigin=new URL(source.href).origin;
      const value=await parseResearchChangePackage({protocol:'hub.research-change.v1',target:{origin:targetOrigin,projectId:source.projectId,documentId:original.sourceId,baseVersion:original.version,baseHash:original.contentHash},body,summary:summary.trim(),contentHash:await researchForkDigest(body)});
      if(generation===life.current){const file=new File([JSON.stringify(value)],'hub-research-change.json',{type:'application/json'});setSaved({url:URL.createObjectURL(file),file,origin:targetOrigin,projectId:source.projectId,documentId:original.sourceId});}
    }catch(e){if(generation===life.current)setError(e instanceof Error?e.message:'変更ファイルを準備できません。');}finally{if(generation===life.current)setBusy(false);}
  }
  return <details><summary>原本のHubへ変更を提案する</summary>
    <p>表示中の本文を変更ファイルへ保存します。非公開の内容も含まれます。原本のHubでログインし、「変更を提案する」から読み込んで確認してください。</p>
    <p>基準 v{original.version} · 送付先 {new URL(source!.href).origin} · ファイルは本人や出自の証明ではありません。</p>
    <UiInput aria-label="原本への変更の理由" value={summary} maxLength={500} disabled={busy} onChange={e=>{setSummary(e.target.value);setSaved(null);}}/>
    <UiButton type="button" pending={busy} disabled={!summary.trim()} onClick={()=>void prepare()}>変更ファイルを準備</UiButton>
    {saved?<p><a href={saved.url} download="hub-research-change.json">変更ファイルを保存</a> · <a href={`${saved.origin}/v2/research/${saved.projectId}?document=${encodeURIComponent(saved.documentId)}`} target="_blank" rel="noreferrer">原本の文書を開く</a></p>:null}
    {saved?<UiButton type="button" onClick={()=>setPeer(value=>!value)}>{peer?'端末間の受け渡しを閉じる':'保存せず端末間で渡す'}</UiButton>:null}
    {saved&&peer?<P2PTransferPanel key={saved.url} embedded allowRelaySelection pairOrigin={PAIRING_RELAY_ORIGIN} sendFile={saved.file} invitationUrl={`${saved.origin}/v2/research/${saved.projectId}?document=${encodeURIComponent(saved.documentId)}`} maxFileBytes={RESEARCH_CHANGE_BYTES}/>:null}
    {error?<p role="alert">{error}</p>:null}
  </details>;
}
