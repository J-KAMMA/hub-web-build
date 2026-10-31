'use client';
import React,{useEffect,useRef,useState} from 'react';
import {UiButton} from '@/components/ui/primitives';
import {readResearchForkPackage} from '@/lib/research-fork-download';
import type {ResearchForkPackage} from '@/lib/research-fork-package';

export function ResearchForkDownload({origin,projectId}:{origin:string;projectId:string}) {
  const [value,setValue]=useState<ResearchForkPackage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[href,setHref]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{setValue(null);setHref('');setError('');setBusy(false);return()=>controller.current?.abort();},[origin,projectId]);
  useEffect(()=>{
    if(!value)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));setHref(url);
    return()=>URL.revokeObjectURL(url);
  },[value]);
  async function read(){
    if(busy)return;const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
    try{const result=await readResearchForkPackage(origin,projectId,abort.signal);if(!abort.signal.aborted)setValue(result);}
    catch(cause){if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'取得できませんでした。');}
    finally{if(!abort.signal.aborted)setBusy(false);}
  }
  return <details><summary>公開版を持ち出す</summary>
    <p>文書・コードの最新版を保存します。Git履歴・PDF・課題・変更提案は含みません。</p>
    {value?<>
      <p>{value.documents.length}文書 · ライセンス：{value.project.license??'未設定。再利用には権利者の許可が必要です。'}</p>
      {href?<a href={href} download={`${value.project.id}.hub-research.json`}>確認した公開版を保存</a>:null}
      <p>元のHub・文書の版・ハッシュを含みます。ハッシュは内容の識別用で、著者の署名ではありません。</p>
    </>:<UiButton type="button" pending={busy} onClick={()=>void read()}>内容と利用条件を確認</UiButton>}
    {error?<p role="alert">{error}</p>:null}
  </details>;
}
