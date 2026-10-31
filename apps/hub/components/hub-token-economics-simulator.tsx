"use client";

import { useMemo, useState } from "react";
import { simulateHubTokenEconomics } from "@/lib/hub-token-economics";

export function HubTokenEconomicsSimulator() {
  const [gross,setGross]=useState(1000),[discount,setDiscount]=useState(0),[cashback,setCashback]=useState(0);
  const [referral,setReferral]=useState(0),[subsidy,setSubsidy]=useState(0),[cost,setCost]=useState(0);
  const [ethJpy,setEthJpy]=useState(500000),[rate,setRate]=useState(20);
  const result=useMemo(()=>simulateHubTokenEconomics({grossRevenue:gross,discount,cashback,
    referralReward:referral,subsidy,hubPaidProcessingCost:cost,ethJpy,benefitCostRate:rate/100}),
    [gross,discount,cashback,referral,subsidy,cost,ethJpy,rate]);
  const field=(label:string,value:number,set:(n:number)=>void)=><label>{label}<input type="number" min="0"
    value={value} onChange={event=>set(Number(event.target.value))}/></label>;
  return <section><h1>Hub Token 経済シミュレーター</h1>
    <p>自己取引を含め、Hubに残る確定純収益だけを基準に発行量と特典原価の上限を計算します。</p>
    <section>{field("総Hub手数料",gross,setGross)}{field("割引",discount,setDiscount)}
      {field("キャッシュバック",cashback,setCashback)}{field("紹介報酬",referral,setReferral)}
      {field("補助金",subsidy,setSubsidy)}{field("Hub負担決済費",cost,setCost)}
      {field("1 ETHの円換算",ethJpy,setEthJpy)}{field("特典原価率（%）",rate,setRate)}</section>
    <dl><div><dt>Hub純収益</dt><dd>{result.netRevenue.toLocaleString()}円相当</dd></div>
      <div><dt>発行量</dt><dd>{result.issuedHub.toLocaleString()} HUB</dd></div>
      <div><dt>特典原価上限</dt><dd>{result.maximumBenefitCost.toLocaleString()}円相当</dd></div>
      <div><dt>特典控除後</dt><dd>{result.marginAfterBenefit.toLocaleString()}円相当</dd></div></dl></section>;
}
