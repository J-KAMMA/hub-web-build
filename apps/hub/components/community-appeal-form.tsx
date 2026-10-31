"use client";
import React,{useEffect,useRef,useState} from "react";
type Sanction={kind:"legacy"|"audit";id:string;createdAt:string};
type Appeal={id:string;reason:string;status:string;createdAt:string;resolutionNote:string};
type Data={communityId:string;appeals:Appeal[];submission:{sanction:Sanction|null;sanctionKey:string}};
const statusLabels:Record<string,string>={pending:"審査待ち",accepted:"受理済み",rejected:"却下済み",withdrawn:"取り下げ済み"};
export function CommunityAppealForm({communityId,onClose}:{communityId:string;onClose:()=>void}) {
  const [data,setData]=useState<Data|null>(null),[reason,setReason]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const [preview,setPreview]=useState<{reason:string;key:string;sanction:Sanction;id:string}|null>(null),[saved,setSaved]=useState<{id:string;sanction:Sanction}|null>(null);
  const generation=useRef(0),busyRef=useRef(false),scope=useRef(communityId);scope.current=communityId;
  async function load(version:number) {
    const response=await fetch(`/api/communities/${communityId}/appeals`),next=await response.json();
    if(version!==generation.current || scope.current!==communityId)return;
    if(!response.ok)throw new Error(next.error??"異議申立てを読み込めませんでした。");
    if(next.communityId!==communityId || !Array.isArray(next.appeals) || !next.submission || !/^[a-f0-9]{64}$/.test(next.submission.sanctionKey))throw new Error("異議申立ての状態を確認できませんでした。");
    setData(next);
  }
  useEffect(()=>{
    const version=++generation.current;setData(null);setPreview(null);setReason("");setSaved(null);setMessage("");
    busyRef.current=true;setBusy(true);
    void load(version).catch(error=>{if(version===generation.current)setMessage(error.message);}).finally(()=>{if(version===generation.current){busyRef.current=false;setBusy(false);}});
    return ()=>{generation.current++;};
  },[communityId]); // The selected community owns this form and all responses.
  useEffect(()=>{
    if(saved && data?.appeals.some(item=>item.id===saved.id && ["accepted","rejected","withdrawn"].includes(item.status)) && data.submission.sanction && JSON.stringify(data.submission.sanction)!==JSON.stringify(saved.sanction)){
      setSaved(null);setPreview(null);setReason("");setMessage("");
    }
  },[data,saved]);
  const sanction=data?.submission.sanction,unavailable=!data?"状態を読み込んでください。":data.appeals.some(item=>item.status==="pending")?"審査中の異議申立てがあります。":!sanction?"現在の異議申立て対象がありません。":"";
  async function refresh() {
    if(busyRef.current)return;
    const version=generation.current;busyRef.current=true;setBusy(true);
    try{await load(version);if(version===generation.current)setMessage(saved?"申立ては保存済みです。":"");}
    catch(error){if(version===generation.current)setMessage(`${saved?"申立ては保存済みです。":""}${error instanceof Error?error.message:"状態を読み込めませんでした。"}`);}
    finally{if(version===generation.current){busyRef.current=false;setBusy(false);}}
  }
  async function submit() {
    if(busyRef.current || saved || !preview || unavailable)return;
    if(preview.reason!==reason.normalize("NFKC").trim() || preview.key!==data?.submission.sanctionKey || JSON.stringify(preview.sanction)!==JSON.stringify(sanction)){setPreview(null);setMessage("変更した内容をもう一度確認してください。");return;}
    const version=generation.current;busyRef.current=true;setBusy(true);setMessage("");
    try {
      const response=await fetch(`/api/communities/${communityId}/appeals`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operationId:preview.id,reason:preview.reason,expectedSanctionKey:preview.key})}),result=await response.json();
      if(version!==generation.current || scope.current!==communityId)return;
      if(!response.ok)throw new Error(result.error??"異議申立てを送信できませんでした。");
      if(!result.appeal?.id || result.appeal.status!=="pending" || result.receipt?.auditId!==preview.id || result.receipt?.action!=="appeal_submitted" || result.receipt?.targetId!==result.appeal.id)throw new Error("保存結果を確認できませんでした。同じ内容で再試行してください。");
      setSaved({id:result.appeal.id,sanction:preview.sanction});setPreview(null);setReason("");setMessage("申立ては保存済みです。");
      try{await load(version);}catch(error){if(version===generation.current)setMessage(`申立ては保存済みです。${error instanceof Error?error.message:"最新状態を読み込めませんでした。"}`);}
    }catch(error){if(version===generation.current)setMessage(error instanceof Error?error.message:"異議申立てを送信できませんでした。");}
    finally{if(version===generation.current){busyRef.current=false;setBusy(false);}}
  }
  function confirm() {
    const normalized=reason.normalize("NFKC").trim();
    if(!sanction || !data || busyRef.current || saved || unavailable)return;
    if(Array.from(normalized).length<20 || normalized.length>1000){setMessage("理由は20〜1000文字で入力してください。");return;}
    setPreview({reason:normalized,key:data.submission.sanctionKey,sanction,id:crypto.randomUUID()});setMessage("");
  }
  return <div className="moderation-operation-backdrop"><section className="moderation-operation-dialog community-appeal-dialog" role="dialog" aria-modal="true" aria-labelledby="community-appeal-title">
    <h2 id="community-appeal-title">処分への異議申立て</h2>
    {data?.appeals.map(item=><article key={item.id}><strong>{statusLabels[item.status]??"状態不明"}</strong><p>{item.reason}</p>{item.resolutionNote && <p>判断理由: {item.resolutionNote}</p>}</article>)}
    <p>{sanction?`処分の記録: ${sanction.createdAt}`:unavailable}</p><p>申立ての承認と処分解除は、運営が対象の一致を確認して判断します。</p>
    <label>申立て理由<textarea value={reason} rows={4} maxLength={1000} disabled={busy || !!saved || !!unavailable} onChange={event=>{setReason(event.target.value);setPreview(null);}} /></label>
    {preview && <section aria-label="申立て内容の確認"><h3>送信する内容</h3><p>{preview.reason}</p><p>処分の記録: {preview.sanction.createdAt}</p><button type="button" disabled={busy || !!saved} onClick={()=>void submit()}>確認して送信</button></section>}
    <p role="status">{message || unavailable}</p><div><button type="button" disabled={busy} onClick={onClose}>閉じる</button><button type="button" disabled={busy} onClick={()=>void refresh()}>状態を再読込</button><button type="button" disabled={busy || !!saved || !!unavailable} onClick={confirm}>申立てを確認</button></div>
  </section></div>;
}
