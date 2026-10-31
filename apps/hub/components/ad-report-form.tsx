"use client";
import { useState } from "react";

export function AdReportForm({token}:{token:string}){
  const[reasonCode,setReasonCode]=useState("misleading"),[detail,setDetail]=useState(""),[message,setMessage]=useState("");
  return <form onSubmit={async(event)=>{event.preventDefault();setMessage("");const response=await fetch("/api/ads/report",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,reasonCode,detail})});setMessage(response.ok?"通報を受け付けました。":"通報を送信できませんでした。");}}>
    <h2>この広告を通報</h2><label>理由<select value={reasonCode} onChange={(event)=>setReasonCode(event.target.value)}><option value="misleading">誤解を招く表示</option><option value="prohibited_product">禁止商品・サービス</option><option value="unsafe_landing">危険なリンク先</option><option value="impersonation">なりすまし</option><option value="copyright">著作権</option><option value="other">その他</option></select></label>
    <label>詳細（任意）<textarea value={detail} maxLength={1000} onChange={(event)=>setDetail(event.target.value)}/></label><button type="submit">通報する</button>{message?<p role="status">{message}</p>:null}
  </form>;
}
