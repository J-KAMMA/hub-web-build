"use client";

import { useEffect, useState } from "react";
import { readMerchantInviteToken, stripMerchantInviteToken } from "@/lib/merchant-invite-link";
import { createMerchantMemberPasskey } from "@/lib/passkey-smart-wallet";

const ACCEPT_URL="/shopping/api/commerce/api/v1/merchant/wallet/invites/accept";

/*
 * token は `#token=` から読む（AUDIT.md 8.3-7）。古いリンクの `?token=` はサーバーから prop で届く。
 * どちらも読んだらすぐに history.replaceState で URL から消し、本文で送る。
 */
export function MerchantInviteAcceptance({token:legacyToken=""}:{token?:string}){
 const[token,setToken]=useState(""),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{const href=window.location.href;setToken(readMerchantInviteToken(href,legacyToken));const stripped=stripMerchantInviteToken(href);if(stripped!==null)window.history.replaceState(window.history.state,"",stripped)},[legacyToken]);
 async function accept(){setBusy(true);setMessage("");try{const key=await createMerchantMemberPasskey(),response=await fetch(ACCEPT_URL,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({token,...key})}),body=await response.json().catch(()=>null)as{error?:string;member?:{role:string}}|null;if(!response.ok)throw new Error(body?.error??"招待を受諾できませんでした。");setDone(true);setMessage(`店舗メンバー（${body?.member?.role??"member"}）として登録しました。`)}catch(error){setMessage(error instanceof Error?error.message:"登録できませんでした。")}finally{setBusy(false)}}
 return <section className="commerce-pos"><h1>店舗ウォレットへの招待</h1><p>この端末に本人確認用のパスキーを作成します。秘密鍵やパスキーの秘密情報がHubへ送信されることはありません。</p>{done?<p role="status">{message}</p>:<><button type="button" disabled={busy||token.length<40} onClick={()=>void accept()}>{busy?"パスキーを作成中…":"Face ID・指紋認証で参加"}</button>{message?<p role="alert">{message}</p>:null}</>}</section>;
}
