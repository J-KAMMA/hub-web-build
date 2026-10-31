"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./hub-token-contribution-card.module.css";

type Entry = { kind:"revenue"|"refund"; id:string; service:string; units:string; status:string; chainId:number; occurredAt:string; onchainStatus:string; onchainChainId:number|null; onchainContractAddress:string|null; onchainTransactionHash:string|null };
type Summary = { balanceBaseUnits:string; issuedBaseUnits:string; reversedBaseUnits:string; pendingBaseUnits:string; benefitEligibleBaseUnits:string; last30DaysBaseUnits:string; last365DaysBaseUnits:string; level:string; linkedWalletCount:number; activeWalletCount:number; byServiceBaseUnits:Array<{service:string;issuedBaseUnits:string}>; benefits:string[]; entries:Entry[] };

const levelNames: Record<string,string> = { supporter:"Supporter", silver:"Silver", gold:"Gold", platinum:"Platinum" };
const serviceNames: Record<string, string> = {
  gohotoken: "GohoToken",
  commerce: "Hubマーケット",
  ai: "AI",
  ads: "広告",
  storage: "ストレージ",
};
export function hubTokenServiceName(service:string) { return serviceNames[service] ?? service; }

export function formatHubTokenBaseUnits(value:string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("invalid_hub_token_base_units");
  const base=BigInt(value), scale=10n**18n, whole=base/scale, fraction=base%scale;
  const wholeText=new Intl.NumberFormat("ja-JP").format(whole);
  if (fraction===0n) return wholeText;
  const visible=fraction.toString().padStart(18,"0").slice(0,8).replace(/0+$/u,"");
  if (!visible) return whole===0n ? "<0.00000001" : wholeText;
  return `${wholeText}.${visible}`;
}

export function hubTokenStatusName(entry:Pick<Entry,"kind"|"status"|"onchainStatus">) {
  if (entry.onchainStatus==="confirmed") return entry.kind==="refund" ? "オンチェーン取消確認済み" : "オンチェーン発行確認済み";
  if (entry.status==="pending") return "台帳確認待ち";
  if (entry.onchainStatus==="not_required") return "端数のため発行なし";
  return entry.kind==="refund" ? "取消処理待ち" : "発行処理待ち";
}

export function hubTokenExplorerUrl(chainId:number|null, transactionHash:string|null) {
  if (!transactionHash) return null;
  const origins:Record<number,string>={137:"https://polygonscan.com",80002:"https://amoy.polygonscan.com",8453:"https://basescan.org",84532:"https://sepolia.basescan.org"};
  const origin=chainId==null ? undefined : origins[chainId];
  return origin ? `${origin}/tx/${encodeURIComponent(transactionHash)}` : null;
}

export function HubTokenContributionCard() {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [summary,setSummary]=useState<Summary|null>(null);
  const [error,setError]=useState("");
  useEffect(() => {
    let active=true;
    void fetch("/api/hub-token/contribution",{cache:"no-store"}).then(async response => {
      if (!response.ok) throw new Error("hub_token_contribution_unavailable");
      const value=await response.json() as Summary;
      if (active) setSummary(value);
    }).catch(() => { if (active) setError("Hub Tokenの記録を取得できませんでした。時間をおいて再読み込みしてください。"); });
    return () => { active=false; };
  },[]);

  return <section className={styles.card} aria-labelledby="hub-token-title">
    <div className={styles.heading}><div><span>HUB CONTRIBUTION</span><h2 id="hub-token-title">Hub Token</h2></div>{summary ? <strong>貢献レベル: {levelNames[summary.level] ?? summary.level}</strong> : null}</div>
    <p className={styles.definition}>GohoTokenのプロトコル手数料やHubマーケットなどから、Hub運営に残った確定純収益を基準にする貢献記録です。譲渡・交換・換金はできず、購入額や売上総額そのものではありません。</p>
    {error ? <p role="alert">{error}</p> : null}{!summary&&!error ? <p role="status">貢献記録を確認しています…</p> : null}
    {summary ? <>
      {summary.linkedWalletCount===0 ? <div className={styles.onboarding}><strong>確認済みウォレットを連携してください</strong><p>ウォレットを連携すると、GohoTokenやHubマーケットからHub運営に残った確定純収益に基づく貢献記録を確認できます。</p><Link href={hubSurfacePath(surface, "/account/payment")}>ウォレットを連携</Link></div> : null}
      <div className={styles.total}><p>累計発行 {formatHubTokenBaseUnits(summary.issuedBaseUnits)} HUB・取消 {formatHubTokenBaseUnits(summary.reversedBaseUnits)} HUB</p><span>現在の記録</span><b>{formatHubTokenBaseUnits(summary.balanceBaseUnits)} HUB</b><small>1 HUBは、返金・値引き・還元・Hub負担費用を差し引いて確認された運営純収益のmicroETH相当です。</small></div>
      <dl className={styles.metrics}><div><dt>確認待ち</dt><dd>{formatHubTokenBaseUnits(summary.pendingBaseUnits)}</dd></div><div><dt>レベル判定対象</dt><dd>{formatHubTokenBaseUnits(summary.benefitEligibleBaseUnits)}</dd></div><div><dt>過去30日</dt><dd>{formatHubTokenBaseUnits(summary.last30DaysBaseUnits)}</dd></div><div><dt>過去365日</dt><dd>{formatHubTokenBaseUnits(summary.last365DaysBaseUnits)}</dd></div><div><dt>確認済みウォレット</dt><dd>{summary.activeWalletCount} / {summary.linkedWalletCount}</dd></div></dl>
      {summary.byServiceBaseUnits.length ? <div className={styles.services}><h3>サービス別</h3>{summary.byServiceBaseUnits.map(row => <div key={row.service}><span>{hubTokenServiceName(row.service)}</span><b>{formatHubTokenBaseUnits(row.issuedBaseUnits)} HUB</b></div>)}</div> : null}
      {summary.benefits.length ? <div className={styles.benefits}><h3>{levelNames[summary.level] ?? summary.level}貢献レベルの特典</h3><ul>{summary.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul></div> : null}
      {summary.entries.length ? <div className={styles.history}><h3>発行・取消履歴</h3>{summary.entries.map(entry => { const explorerUrl=hubTokenExplorerUrl(entry.onchainChainId,entry.onchainTransactionHash); return <div key={`${entry.kind}:${entry.id}`}><span><b>{entry.kind==="refund" ? "取消" : "貢献発行"}</b><small>{hubTokenServiceName(entry.service)}・Chain {entry.chainId}・{new Date(entry.occurredAt).toLocaleString("ja-JP")}</small><small>{hubTokenStatusName(entry)}</small>{explorerUrl ? <a href={explorerUrl} target="_blank" rel="noreferrer">取引を確認</a> : null}</span><strong>{entry.kind==="refund" ? "−" : "+"}{formatHubTokenBaseUnits(entry.units)} HUB</strong></div>; })}</div> : null}
      <p className={styles.notice}>特典は、Hub運営に残った確定純収益に基づく貢献レベルで判定します。HUB残高に配当、交換請求権、価格保証はありません。</p>
    </> : null}
  </section>;
}
