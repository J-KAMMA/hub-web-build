"use client";
import {FormEvent,useState} from "react";
import styles from "./advertiser-dashboard.module.css";
type Campaign=Record<string,unknown>;
const yen=(micros:number)=>`¥${Math.round(micros/1_000_000).toLocaleString("ja-JP")}`;

export function AdvertiserOptimizationTools({campaigns}:{campaigns:Campaign[]}){
  const [result,setResult]=useState<Record<string,unknown>|null>(null),[message,setMessage]=useState("");
  const post=async(event:FormEvent<HTMLFormElement>,path:string,body:Record<string,unknown>)=>{event.preventDefault();setMessage("");const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const value=await response.json().catch(()=>null) as Record<string,unknown>|null;if(path.endsWith("simulate")&&response.ok)setResult(value);setMessage(response.ok?"受け付けました。":String(value?.error??"処理に失敗しました。"));};
  return <>
    <section><h2>配信シミュレーター</h2><p>過去実績と掲載面の標準値を使って自動試算します。結果は保証値ではありません。</p>
      <form className={styles.form} onSubmit={(event)=>{const form=new FormData(event.currentTarget);void post(event,"/api/ads/advertiser/simulate",{budgetJpyMicros:Number(form.get("budget"))*1_000_000,days:Number(form.get("days")),objective:String(form.get("objective")),placementKey:String(form.get("placementKey"))});}}>
        <label>予算（円）<input name="budget" type="number" min="1" required/></label><label>期間（日）<input name="days" type="number" min="1" max="366" defaultValue="30" required/></label><label>目的<select name="objective"><option value="awareness">認知</option><option value="website_visits">Web誘導</option><option value="sponsorship">スポンサー</option></select></label><label>掲載面<select name="placementKey"><option value="home.feed.inline">フィード</option><option value="threads.replies.inline">スレッド</option><option value="videos.discovery.inline">動画</option><option value="hubpedia.article.inline">Hubpedia記事</option></select></label><button>自動試算</button>
      </form>
      {result?<article><strong>試算結果</strong><span>配信 {Number(result.estimatedServed).toLocaleString("ja-JP")} ・ 視認 {Number(result.estimatedViewable).toLocaleString("ja-JP")} ・ クリック {Number(result.estimatedClicks).toLocaleString("ja-JP")} ・ 成果 {Number(result.estimatedConversions).toLocaleString("ja-JP")}</span><small>想定費用 {yen(Number(result.estimatedSpendJpyMicros))}</small></article>:null}
    </section>
    <section><h2>スポンサー優先枠</h2><p>指定期間に優先配信します。表示回数の保証や未達補填はありません。</p>{campaigns.some((campaign)=>campaign.objective==="sponsorship")?<form className={styles.form} onSubmit={(event)=>{const form=new FormData(event.currentTarget),id=String(form.get("campaignId"));void post(event,`/api/ads/advertiser/campaigns/${encodeURIComponent(id)}/sponsor-reservations`,{placementKey:String(form.get("placementKey")),startAt:Date.parse(String(form.get("startAt"))),endAt:Date.parse(String(form.get("endAt"))),reservedBudgetJpyMicros:Number(form.get("budget"))*1_000_000});}}>
      <label>キャンペーン<select name="campaignId">{campaigns.filter((campaign)=>campaign.objective==="sponsorship").map((campaign)=><option key={String(campaign.id)} value={String(campaign.id)}>{String(campaign.campaignName)}</option>)}</select></label><label>掲載面<select name="placementKey"><option value="home.feed.inline">フィード</option><option value="threads.replies.inline">スレッド</option><option value="videos.discovery.inline">動画</option><option value="hubpedia.article.inline">Hubpedia記事</option></select></label><label>開始<input name="startAt" type="datetime-local" required/></label><label>終了<input name="endAt" type="datetime-local" required/></label><label>予算（円）<input name="budget" type="number" min="1" required/></label><button>優先枠の審査を申請</button>
    </form>:<p>スポンサー目的のキャンペーンはまだありません。</p>}{message?<p role="status">{message}</p>:null}</section>
  </>;
}
