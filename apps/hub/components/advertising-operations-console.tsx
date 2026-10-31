"use client";

import React, { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { ClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createWalletClient, custom, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import styles from "./advertising-operations-console.module.css";
import { getHubEvmProvider, type HubEvmProvider } from "@/components/hub-wallet-provider";
import { recordPaymentTaxEvent } from "@/lib/payment-tax-client";

type RecordValue = Record<string, unknown>;
type EthereumProvider = HubEvmProvider;

function stringValue(value: FormDataEntryValue | null) { return typeof value === "string" ? value.trim() : ""; }
function jpyMicros(value: FormDataEntryValue | null) { const amount = Number(value); const micros = amount * 1_000_000; return Number.isSafeInteger(amount) && amount >= 0 && Number.isSafeInteger(micros) ? micros : Number.NaN; }
function timestamp(value: FormDataEntryValue | null) { return Date.parse(stringValue(value)); }
function field(item: RecordValue, key: string) { const value = item[key]; return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function count(item: RecordValue, key: string) { const value = Number(field(item, key)); return Number.isFinite(value) && value >= 0 ? value : 0; }
function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : "—";
}
function transactionHash(item: RecordValue) {
  const value = field(item, "latestX402TransactionHash");
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() : "";
}
function dateTime(value: number) {
  return value > 0 ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(value) : "";
}

async function requestJson(path: string, method: "POST" | "PATCH", body: unknown, idempotent = false) {
  const response = await fetch(path, { method, credentials: "same-origin", headers: {
    "Content-Type": "application/json", ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as RecordValue;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
  return result;
}

async function uploadAsset(body: FormData) {
  const response = await fetch("/api/admin/ads/assets", { method: "POST", credentials: "same-origin", body });
  const result = await response.json().catch(() => ({})) as RecordValue;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
  return result;
}

export function AdvertisingOperationsConsole({ placements, campaigns, creatives, lineItems, assets = [], reports = { rows: [], reviews: [], privacyThreshold: 100 }, alerts = [], health = {} }: {
  placements: RecordValue[]; campaigns: RecordValue[]; creatives: RecordValue[]; lineItems: RecordValue[]; assets?: RecordValue[];
  reports?: { rows: RecordValue[]; reviews: RecordValue[]; privacyThreshold: number };
  alerts?: RecordValue[]; health?: RecordValue;
}) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [advertiserRef, setAdvertiserRef] = useState(""); const [reviewReason, setReviewReason] = useState("");
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage("");
    try { await operation(); setMessage(success); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作に失敗しました。"); }
    finally { setBusy(false); }
  };
  const generateAdvertiserRef = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    setAdvertiserRef(`adv_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`);
  };
  const submitPlacement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(() => requestJson("/api/admin/ads/placements", "POST", {
      placementKey: stringValue(data.get("placementKey")), displayName: stringValue(data.get("displayName")),
      surfaceType: stringValue(data.get("surfaceType")), pageCategory: stringValue(data.get("pageCategory")),
      format: stringValue(data.get("format")), allowedDimensions: [], pricingModel: stringValue(data.get("pricingModel")),
      floorPriceJpyMicros: jpyMicros(data.get("floorPriceJpy")), maximumAdsPerPage: Number(data.get("maximumAdsPerPage")),
      targetingAllowed: ["pageCategories", "contentTags", "contentKeywords", "languages"],
    }, true), "広告枠を保存しました。");
  };
  const submitCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(() => requestJson("/api/admin/ads/campaigns", "POST", {
      advertiserRef, campaignName: stringValue(data.get("campaignName")), objective: stringValue(data.get("objective")),
      pricingModel: stringValue(data.get("pricingModel")), totalBudgetJpyMicros: jpyMicros(data.get("totalBudgetJpy")),
      dailyBudgetJpyMicros: jpyMicros(data.get("dailyBudgetJpy")), startAt: timestamp(data.get("startAt")), endAt: timestamp(data.get("endAt")),
    }, true), "キャンペーンを保存しました。");
  };
  const submitCreative = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void run(() => requestJson("/api/admin/ads/creatives", "POST", { advertiserRef,
      format: stringValue(data.get("format")), assetId: stringValue(data.get("assetId")) || undefined,
      headline: stringValue(data.get("headline")), description: stringValue(data.get("description")),
      altText: "", callToAction: stringValue(data.get("callToAction")), landingUrl: stringValue(data.get("landingUrl")),
      displayUrl: "", advertiserDisplayName: stringValue(data.get("advertiserDisplayName")), language: "ja",
    }, true), "素材を登録し、審査待ちにしました。");
  };
  const submitAsset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); data.set("advertiserRef", advertiserRef);
    void run(() => uploadAsset(data), "画像を隔離し、外部スキャン待ちにしました。");
  };
  const submitLineItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const campaignId = stringValue(data.get("campaignId"));
    void run(() => requestJson(`/api/admin/ads/campaigns/${encodeURIComponent(campaignId)}/line-items`, "POST", {
      name: stringValue(data.get("name")), placementIds: [stringValue(data.get("placementId"))], targetingRules: {},
      pricingModel: stringValue(data.get("pricingModel")), rateJpyMicros: jpyMicros(data.get("rateJpy")),
      budgetJpyMicros: jpyMicros(data.get("budgetJpy")), startAt: timestamp(data.get("startAt")), endAt: timestamp(data.get("endAt")),
      priority: 0, pacingMode: "even", frequencyCapCount: 3, frequencyCapWindowSeconds: 86_400,
    }, true), "ラインアイテムを保存しました。");
  };
  const attachCreative = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const lineItemId = stringValue(data.get("lineItemId"));
    void run(() => requestJson(`/api/admin/ads/line-items/${encodeURIComponent(lineItemId)}/creatives`, "POST",
      { creativeId: stringValue(data.get("creativeId")) }), "素材をラインアイテムへ関連付けました。");
  };
  const review = (kind: "campaigns" | "creatives", id: string, decision: string) => {
    if (!reviewReason.trim()) { setMessage("審査理由を入力してください。"); return; }
    void run(() => requestJson(`/api/admin/ads/${kind}/${encodeURIComponent(id)}/review`, "POST", { decision, reason: reviewReason }), "審査結果を保存しました。");
  };
  const delivery = (id: string, action: "activate" | "pause") => void run(() => requestJson(
    `/api/admin/ads/campaigns/${encodeURIComponent(id)}/delivery`, "POST", { action }), action === "activate" ? "配信を開始しました。" : "配信を停止しました。");
  const checkLanding = (id: string) => void run(() => requestJson(
    `/api/admin/ads/creatives/${encodeURIComponent(id)}/landing-check`, "POST", {}), "リンク先検査を完了しました。");

  const fundCampaign = (event: FormEvent<HTMLFormElement>, campaignId: string, campaignAdvertiserRef: string) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const amountJpyMicros = jpyMicros(data.get("fundingJpy"));
    void run(async () => {
      if (!campaignAdvertiserRef) throw new Error("キャンペーンの広告主IDを確認できませんでした。");
      const created = await requestJson(`/api/admin/ads/campaigns/${encodeURIComponent(campaignId)}/x402-deposits`, "POST",
        { advertiserRef: campaignAdvertiserRef, amountJpyMicros });
      const quote = created.quote as RecordValue | undefined;
      const depositId = quote && field(quote, "id"); const network = quote && field(quote, "network");
      const amountAtomic = quote ? field(quote, "amountUsdcAtomic") : "";
      if (!depositId || network !== "eip155:84532" || !/^\d+$/.test(amountAtomic)) throw new Error("安全なx402見積りを取得できませんでした。");
      const provider = getHubEvmProvider() as EthereumProvider | null;
      if (!provider) throw new Error("x402対応ウォレットが見つかりません。");
      await switchToBaseSepolia(provider);
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) throw new Error("ウォレットを確認できません。");
      const address = getAddress(accounts[0]); const walletClient = createWalletClient({ account: address, chain: baseSepolia, transport: custom(provider) });
      const signer: ClientEvmSigner = { address, async signTypedData(message) { return walletClient.signTypedData(message as Parameters<typeof walletClient.signTypedData>[0]); } };
      const maximum = BigInt(amountAtomic);
      const client = new x402Client().register(network, new ExactEvmScheme(signer))
        .registerPolicy((_version, requirements) => requirements.filter((requirement) => allowedDeposit(requirement, network, maximum)));
      const response = await wrapFetchWithPayment(fetch, client)(`/api/admin/ads/x402-deposits/${encodeURIComponent(depositId)}/settle`,
        { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json().catch(() => ({})) as RecordValue;
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "x402決済を確定できませんでした。");
      if (typeof result.taxReceipt === "string") await recordPaymentTaxEvent(result.taxReceipt);
    }, "x402入金を確認し、広告予算へ反映しました。");
  };

  const reviewTraffic = (id: string, decision: "reviewed" | "dismissed") => {
    if (!reviewReason.trim()) { setMessage("確認理由を入力してください。"); return; }
    void run(() => requestJson(`/api/admin/ads/traffic-reviews/${encodeURIComponent(id)}`, "POST",
      { decision, note: reviewReason }), decision === "reviewed" ? "確認済みにしました。" : "誤検知として処理しました。");
  };
  const rebuildReports = () => void run(
    () => requestJson("/api/admin/ads/reports/rebuild", "POST", {}),
    "広告レポートを再集計しました。",
  );

  return <section className={styles.page}>
    <header className={styles.header}><div><span>HUB ADS OPERATIONS</span><h1>広告運用管理</h1><p>広告枠、予算、素材審査、配信状態を一元管理します。</p></div>
      <nav><a href="/admin/advertising">インベントリー</a><a href="/admin/advertising/mock">モック</a></nav></header>
    <section className={styles.safety}><strong>安全状態</strong><span>画像は隔離・構造検査・外部スキャン後のみ利用可</span><span>広告全体はDBキルスイッチで停止中</span></section>
    <div className={styles.actor}><label>広告主参照ID<input value={advertiserRef} onChange={(event) => setAdvertiserRef(event.target.value)} placeholder="adv_…" /></label>
      <button type="button" onClick={generateAdvertiserRef}>新規IDを生成</button><label>審査理由<input value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label></div>
    {message ? <p className={styles.message} role="status">{message}</p> : null}
    <div className={styles.grid} aria-busy={busy}>
      <section className={styles.panel}><h2>運用監視</h2>
        <p>キャンペーン {field(health, "campaigns")}件 · 配信中 {field(health, "activeCampaigns")}件 · 審査待ち {field(health, "pendingReview")}件 · 画像処理待ち {field(health, "pendingAssets")}件</p>
        <button type="button" disabled={busy} onClick={() => void run(() => requestJson("/api/admin/ads/alerts", "POST", {}), "運用状態を再検査しました。")}>今すぐ検査</button>
        <div className={styles.list}>{alerts.length ? alerts.map((item) => <article key={field(item, "id")}><strong>{field(item, "severity")} · {field(item, "category")}</strong><p>{field(item, "summary")}</p><small>{dateTime(count(item, "updatedAt"))}</small></article>) : <p>未解決の運用アラートはありません。</p>}</div>
      </section>
      <section className={styles.panel}><h2>広告枠</h2><form onSubmit={submitPlacement} className={styles.form}>
        <label>枠キー<input name="placementKey" placeholder="home.feed.inline" required /></label><label>表示名<input name="displayName" required /></label>
        <label>画面種別<input name="surfaceType" defaultValue="feed" required /></label><label>ページカテゴリ<input name="pageCategory" defaultValue="community" required /></label>
        <label>形式<select name="format"><option value="native">ネイティブ</option><option value="text">テキスト</option><option value="static_display">静止画像</option></select></label>
        <label>課金<select name="pricingModel"><option value="viewable_cpm">ビューアブルCPM</option><option value="fixed_period">固定期間</option></select></label>
        <label>最低単価（円）<input name="floorPriceJpy" type="number" min="0" defaultValue="500" required /></label>
        <label>最大表示数<input name="maximumAdsPerPage" type="number" min="0" max="3" defaultValue="1" required /></label><button disabled={busy}>枠を作成</button>
      </form><div className={styles.list}>{placements.map((item) => <article key={field(item, "id")}><strong>{field(item, "displayName")}</strong><code>{field(item, "placementKey")}</code><span>{field(item, "status")}</span></article>)}</div></section>
      <section className={styles.panel}><h2>キャンペーン</h2><form onSubmit={submitCampaign} className={styles.form}>
        <label>名称<input name="campaignName" required /></label><label>目的<select name="objective"><option value="awareness">認知</option><option value="website_visits">Web誘導</option><option value="sponsorship">スポンサー</option></select></label>
        <label>課金<select name="pricingModel"><option value="viewable_cpm">ビューアブルCPM</option><option value="fixed_period">固定期間</option></select></label>
        <label>総予算（円）<input name="totalBudgetJpy" type="number" min="1" required /></label><label>日予算（円）<input name="dailyBudgetJpy" type="number" min="1" required /></label>
        <label>開始<input name="startAt" type="datetime-local" required /></label><label>終了<input name="endAt" type="datetime-local" required /></label><button disabled={busy || !advertiserRef}>作成</button>
      </form><div className={styles.list}>{campaigns.map((item) => <article key={field(item, "id")}><strong>{field(item, "campaignName")}</strong><span>{field(item, "status")} / {field(item, "reviewStatus")}</span>
        <span>入金済み ¥{(Number(field(item, "fundedJpyMicros")) / 1_000_000).toLocaleString("ja-JP")} / 予算 ¥{(Number(field(item, "totalBudgetJpyMicros")) / 1_000_000).toLocaleString("ja-JP")}</span>
        {field(item, "latestX402Status") ? <span>最新x402決済: {field(item, "latestX402Status")} ・ {(count(item, "latestX402AmountUsdcAtomic") / 1_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 6 })} test USDC{count(item, "latestX402SettledAt") ? ` ・ ${dateTime(count(item, "latestX402SettledAt"))}` : ""}</span> : null}
        {transactionHash(item) ? <a href={`https://sepolia.basescan.org/tx/${transactionHash(item)}`} target="_blank" rel="noopener noreferrer">BaseScanで決済を確認</a> : null}
        <form onSubmit={(event) => fundCampaign(event, field(item, "id"), field(item, "advertiserRef"))}><label>x402前払い（円）<input name="fundingJpy" type="number" min="1" required /></label><button disabled={busy}>MetaMaskでBase Sepolia USDCを入金</button></form>
        <div><button onClick={() => review("campaigns", field(item, "id"), "approved")} disabled={busy}>承認</button><button onClick={() => delivery(field(item, "id"), "activate")} disabled={busy}>開始</button><button onClick={() => delivery(field(item, "id"), "pause")} disabled={busy}>停止</button></div></article>)}</div></section>
      <section className={styles.panel}><h2>素材</h2><form onSubmit={submitCreative} className={styles.form}>
        <label>形式<select name="format"><option value="native">ネイティブ</option><option value="text">テキスト</option><option value="static_display">静止画像</option></select></label><label>広告主表示名<input name="advertiserDisplayName" required /></label>
        <label>スキャン済み画像<select name="assetId"><option value="">画像なし</option>{assets.filter((item) => field(item, "status") === "clean" && field(item, "advertiserRef") === advertiserRef).map((item) => <option key={field(item, "id")} value={field(item, "id")}>{field(item, "id")} · {field(item, "width")}×{field(item, "height")}</option>)}</select></label>
        <label>見出し<input name="headline" maxLength={120} required /></label><label>説明<input name="description" maxLength={500} /></label>
        <label>CTA<input name="callToAction" defaultValue="詳しく見る" required /></label><label>リンク先<input name="landingUrl" type="url" placeholder="https://example.com/" required /></label><button disabled={busy || !advertiserRef}>審査へ登録</button>
      </form><div className={styles.list}>{creatives.map((item) => <article key={field(item, "id")}><strong>{field(item, "headline")}</strong><span>{field(item, "advertiserDisplayName")} · {field(item, "reviewStatus")}</span>
        <span>リンク先 {field(item, "landingResult") || "未検査"} {field(item, "landingReason") ? `· ${field(item, "landingReason")}` : ""}</span>
        <div><button onClick={() => checkLanding(field(item, "id"))} disabled={busy}>リンク先を検査</button><button onClick={() => review("creatives", field(item, "id"), "approved")} disabled={busy}>現行版を承認</button></div></article>)}</div></section>
      <section className={styles.panel}><h2>画像隔離</h2><form onSubmit={submitAsset} className={styles.form}>
        <label>PNG（最大5MB）<input name="file" type="file" accept="image/png,.png" required /></label>
        <button disabled={busy || !advertiserRef}>隔離領域へアップロード</button>
      </form><div className={styles.list}>{assets.map((item) => <article key={field(item, "id")}><strong>{field(item, "width") || "?"} × {field(item, "height") || "?"}</strong>
        <code>{field(item, "id")}</code><span>{field(item, "status")} · 構造検査 {field(item, "structuralResult")} · スキャン {field(item, "scannerResult") || "待機中"}</span></article>)}</div></section>
      <section className={styles.panel}><h2>配信設定</h2><form onSubmit={submitLineItem} className={styles.form}>
        <label>キャンペーン<select name="campaignId" required>{campaigns.map((item) => <option key={field(item, "id")} value={field(item, "id")}>{field(item, "campaignName")}</option>)}</select></label>
        <label>広告枠<select name="placementId" required>{placements.map((item) => <option key={field(item, "id")} value={field(item, "id")}>{field(item, "displayName")}</option>)}</select></label>
        <label>名称<input name="name" required /></label><label>課金<select name="pricingModel"><option value="viewable_cpm">ビューアブルCPM</option><option value="fixed_period">固定期間</option></select></label>
        <label>単価（円）<input name="rateJpy" type="number" min="0" required /></label><label>予算（円）<input name="budgetJpy" type="number" min="1" required /></label>
        <label>開始<input name="startAt" type="datetime-local" required /></label><label>終了<input name="endAt" type="datetime-local" required /></label><button disabled={busy}>設定を作成</button>
      </form><form onSubmit={attachCreative} className={styles.form}><label>配信設定<select name="lineItemId" required>{lineItems.map((item) => <option key={field(item, "id")} value={field(item, "id")}>{field(item, "name")}</option>)}</select></label>
        <label>素材<select name="creativeId" required>{creatives.map((item) => <option key={field(item, "id")} value={field(item, "id")}>{field(item, "headline")}</option>)}</select></label><button disabled={busy}>関連付け</button></form></section>
      <section className={styles.panel}><h2>配信・消化レポート</h2>
        <p>配信数が{reports.privacyThreshold}未満の行はプライバシー保護のため表示しません。</p>
        <p><button type="button" disabled={busy} onClick={rebuildReports}>レポートを再集計</button> ・ <a href="/api/admin/ads/reports/export?days=30">過去30日をCSV出力</a></p>
        <div className={styles.list}>{reports.rows.map((item) => {
          const served = count(item, "served"); const rendered = count(item, "rendered");
          const viewable = count(item, "viewable"); const clicked = count(item, "clicked");
          return <article key={`${field(item, "reportDay")}:${field(item, "campaignId")}`}>
            <strong>{field(item, "campaignName")}</strong><span>{field(item, "reportDay")}</span>
            <span>配信 {served.toLocaleString("ja-JP")} ・ レンダー {rendered.toLocaleString("ja-JP")} ・ ビューアブル {viewable.toLocaleString("ja-JP")}</span>
            <span>ビューアブル率 {percentage(viewable, rendered)} ・ クリック {clicked.toLocaleString("ja-JP")} ・ CTR {percentage(clicked, served)}</span>
            <span>消化額 ¥{(count(item, "spendJpyMicros") / 1_000_000).toLocaleString("ja-JP")}</span>
          </article>;
        })}{reports.rows.length === 0 ? <p>閾値を満たす確定済みレポートはまだありません。日次集計後に表示されます。</p> : null}</div>
        <h3>不正トラフィック確認</h3><div className={styles.list}>{reports.reviews.map((item) => <article key={field(item, "id")}>
          <strong>{field(item, "severity")} ・ {field(item, "reasonCode")}</strong><span>{field(item, "reportDay")} ・ {field(item, "status")}</span>
          <span>観測 {field(item, "observedCount")} / 基準 {field(item, "baselineCount")}</span>
          {field(item, "status") === "open" ? <div><button type="button" disabled={busy} onClick={() => reviewTraffic(field(item, "id"), "reviewed")}>確認済み</button>
            <button type="button" disabled={busy} onClick={() => reviewTraffic(field(item, "id"), "dismissed")}>誤検知</button></div> : null}
        </article>)}</div>
      </section>
    </div>
  </section>;
}

function allowedDeposit(requirement: PaymentRequirements, network: string, maximum: bigint) {
  if (requirement.network !== network || requirement.scheme !== "exact") return false;
  try { return BigInt(requirement.amount) === maximum; } catch { return false; }
}

async function switchToBaseSepolia(provider: EthereumProvider) {
  try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] }); }
  catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code?: unknown }).code : undefined;
    if (code !== 4902) throw cause;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x14a34", chainName: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] }] });
  }
}
