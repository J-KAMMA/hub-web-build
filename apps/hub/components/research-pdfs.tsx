'use client';
import React,{useEffect,useState,type FormEvent} from 'react';
import {UiButton,UiField,UiInput,UiSelect} from '@/components/ui/primitives';
type Pdf={id:string;title:string;seriesId:string;version:number;visibility:string;scanStatus:string;size:number};
const statuses:Record<string,string>={pending:'検査待ち',failed:'検査に接続できません',rejected:'検査で拒否されました',clean:'検査済み'};
export function ResearchPdfs({projectId,canEdit}:{projectId:string;canEdit:boolean}) {
  const endpoint=`/api/research/projects/${encodeURIComponent(projectId)}/pdfs`;
  const [pdfs,setPdfs]=useState<Pdf[]>([]),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[generation,refresh]=useState(0);
  useEffect(()=>{const controller=new AbortController();setReady(false);fetch(endpoint,{signal:controller.signal}).then(async r=>{const value=await r.json();if(!r.ok)throw Error(value.error);if(!Array.isArray(value.pdfs))throw Error('PDF一覧を読み込めませんでした。');if(!controller.signal.aborted){setPdfs(value.pdfs);setReady(true);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[endpoint,generation]);
  async function send(url:string,body:BodyInit,type:string){setBusy(true);setError('');try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':type},body,signal:AbortSignal.timeout(90000)});const value=await r.json();if(!r.ok)throw Error(value.error);refresh(n=>n+1);return true;}catch(e){setError(e instanceof Error?e.message:'保存できませんでした。');return false;}finally{setBusy(false);}}
  const action=(id:string,action:string,visibility?:string)=>send(endpoint,JSON.stringify({id,action,visibility}),'application/json');
  async function upload(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form),file=data.get('file');if(!(file instanceof File)||!file.size)return;const title=String(data.get('title')||file.name),series=String(data.get('series')||'');if(file.size>10*1024*1024){setError('PDFは10MBまでです。');return;}if(await send(`${endpoint}?${new URLSearchParams({action:'upload',title,...(series?{series}:{})})}`,file,'application/pdf')){form.reset();const details=form.closest('details');if(details)details.open=false;}}
  const series=[...new Map(pdfs.map(pdf=>[pdf.seriesId,pdf])).values()];
  return <section className="research-documents research-files" id="pdfs"><h2>論文PDF</h2><p>PDFは10MBまで。アップロードした版は変更せず保存します。検査済みになってから、版ごとに公開できます。</p>
    {error?<p role="alert">{error} <UiButton type="button" onClick={()=>{setError('');refresh(n=>n+1);}}>再読み込み</UiButton></p>:null}
    {!ready&&!error?<p role="status">読み込み中…</p>:null}
    {ready&&!pdfs.length?<p>PDFはまだありません。</p>:null}
    {pdfs.map(pdf=><article key={pdf.id}><h3>{pdf.title} · v{pdf.version}</h3><p>{statuses[pdf.scanStatus] ?? '確認中'} · {pdf.visibility==='public'?'公開':'非公開'} · {(pdf.size/1024).toFixed(0)}KB</p>
      {pdf.scanStatus==='clean'?<a href={`${endpoint}?pdf=${encodeURIComponent(pdf.id)}&download=1`}>PDFをダウンロード</a>:null}
      {canEdit&&['pending','failed'].includes(pdf.scanStatus)?<UiButton type="button" disabled={busy} onClick={()=>action(pdf.id,'scan')}>検査する</UiButton>:null}
      {canEdit&&pdf.scanStatus==='clean'?<details><summary>公開範囲を変更</summary><p>この版のPDFを公開します。プロジェクトが非公開の場合は所有者だけが閲覧できます。</p><UiButton type="button" disabled={busy} onClick={()=>action(pdf.id,'visibility',pdf.visibility==='public'?'confidential':'public')}>{pdf.visibility==='public'?'非公開にする':'この版を公開する'}</UiButton></details>:null}
    </article>)}
    {canEdit?<details><summary>PDFをアップロード</summary><form onSubmit={upload}><UiField label="PDFの名前"><UiInput name="title" maxLength={240} placeholder="省略するとファイル名を使います"/></UiField>
      <UiField label="改訂先"><UiSelect aria-label="PDFの改訂先" name="series"><option value="">新しい論文</option>{series.map(pdf=><option value={pdf.seriesId} key={pdf.seriesId}>{pdf.title}</option>)}</UiSelect></UiField>
      <UiField label="PDFファイル"><input aria-label="PDFファイル" type="file" name="file" accept="application/pdf,.pdf" required/></UiField><UiButton disabled={!ready} pending={busy}>非公開でアップロード</UiButton></form></details>:null}
  </section>;
}
