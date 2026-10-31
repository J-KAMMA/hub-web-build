"use client";

import { useEffect, useState } from "react";

const API = "/shopping/api/commerce/api/v1/seller/gas-budget";
type GasBudget = {chainId:number;availableAtomic:number;reservedAtomic:number;spentAtomic:number;perOrderLimitAtomic:number;monthlyLimitAtomic:number|null;monthSpentAtomic:number;monthKey:string;status:"active"|"paused";updatedAt:string};
type Reservation={id:string;orderId:string;maximumCostAtomic:number;actualCostAtomic:number|null;status:string;validUntil:string;createdAt:string;confirmedAt:string|null};

function nativeAmount(value:number):string{return `${(value/1_000_000_000_000_000_000).toLocaleString("ja-JP",{maximumFractionDigits:6})} POL`}

export function MerchantGasBudgetPanel(){
 const [budget,setBudget]=useState<GasBudget|null>(null),[reservations,setReservations]=useState<Reservation[]>([]),[message,setMessage]=useState("読み込み中…");
 async function load(){try{const response=await fetch(`${API}?chainId=80002`,{credentials:"include",cache:"no-store"});if(!response.ok)throw new Error();const body=await response.json() as {budget:GasBudget|null;reservations:Reservation[]};setBudget(body.budget);setReservations(body.reservations??[]);setMessage(body.budget?"":"店舗負担のガス予算はまだ設定されていません。")}catch{setMessage("ガス予算を確認できませんでした。")}}
 useEffect(()=>{void load()},[]);
 return <section className="commerce-order-panel" aria-labelledby="merchant-gas-budget-title"><header><div><small>NETWORK PROCESSING BUDGET</small><h2 id="merchant-gas-budget-title">ネットワーク処理費</h2><p>ガス代とファシリテーター費用をまとめた店舗負担の処理費です。Hub決済手数料と購入者への上乗せはありません。</p></div><button type="button" onClick={()=>void load()}>更新</button></header>{budget?<><dl><div><dt>利用可能</dt><dd>{nativeAmount(budget.availableAtomic)}</dd></div><div><dt>予約中</dt><dd>{nativeAmount(budget.reservedAtomic)}</dd></div><div><dt>累計使用</dt><dd>{nativeAmount(budget.spentAtomic)}</dd></div><div><dt>1注文の上限</dt><dd>{nativeAmount(budget.perOrderLimitAtomic)}</dd></div><div><dt>{budget.monthKey} 使用額</dt><dd>{nativeAmount(budget.monthSpentAtomic)}</dd></div><div><dt>状態</dt><dd>{budget.status==="active"?"利用可能":"一時停止"}</dd></div></dl>{reservations.length?<div className="commerce-order-list">{reservations.map(item=><article key={item.id}><div className="commerce-order-summary"><small>注文 {item.orderId.slice(0,8)}</small><b>{item.status}</b><span>上限 {nativeAmount(item.maximumCostAtomic)}</span><span>実費 {item.actualCostAtomic==null?"確定待ち":nativeAmount(item.actualCostAtomic)}</span><time>{new Date(item.createdAt).toLocaleString("ja-JP")}</time></div></article>)}</div>:<p>利用履歴はありません。</p>}</>:<p role="status">{message}</p>}</section>;
}
