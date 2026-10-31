"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {V2Button} from "./v2-button";

export function V2ArticleSave({articleId,authenticated,japanese=true,initialSaved,onRemoved}:{articleId:string;authenticated:boolean;japanese?:boolean;initialSaved?:boolean;onRemoved?:()=>void}){
 const [saved,setSaved]=useState<boolean|null>(initialSaved??null),[pending,setPending]=useState(false),[error,setError]=useState(false),[retry,setRetry]=useState(0);
 const busy=useRef(false);
 const url=`/api/articles/${encodeURIComponent(articleId)}/save`;
 useEffect(()=>{
  if(!authenticated||initialSaved!==undefined)return;
  const controller=new AbortController();setError(false);setSaved(null);
  void fetch(url,{cache:"no-store",signal:controller.signal}).then(async response=>{
   const data=await response.json();if(!response.ok||typeof data?.saved!=="boolean")throw new Error();
   if(!controller.signal.aborted)setSaved(data.saved);
  }).catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>controller.abort();
 },[url,authenticated,initialSaved,retry]);
 async function toggle(){
  if(!authenticated||saved===null||busy.current)return;
  busy.current=true;setPending(true);setError(false);const next=!saved;
  try{
   const response=await fetch(url,{method:next?"POST":"DELETE"});const data=await response.json();
   if(!response.ok||data?.saved!==next)throw new Error();
   setSaved(next);if(!next)onRemoved?.();
  }catch{setError(true);}finally{busy.current=false;setPending(false);}
 }
 if(!authenticated)return <Link href={`/v2/auth?next=${encodeURIComponent(`/v2/articles/${articleId}`)}`}>{japanese?"ログインして保存":"Sign in to save"}</Link>;
 return <>
  <V2Button icon="bookmark" variant="text" label={saved?(japanese?"保存済み・解除":"Saved · Remove"):(japanese?"記事を保存":"Save article")} pressed={saved??false} disabled={pending||saved===null} onClick={()=>void toggle()}/>
  {error?<span role="status" className="v2-error">{japanese?"保存状態を確認・更新できませんでした。":"Could not read or update the saved state."}{saved===null?<button className="v2-button v2-button--text" onClick={()=>setRetry(value=>value+1)}>{japanese?"もう一度読み込む":"Try again"}</button>:null}</span>:null}
 </>;
}
