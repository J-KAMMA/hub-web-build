"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import React, { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AdvertiserCampaignWizard } from "./advertiser-campaign-wizard";
import {
  UiButton,
  UiInput,
  UiSelect,
  UiStatePanel,
  UiTextarea,
} from "@/components/ui/primitives";
import styles from "./advertiser-dashboard.module.css";

type Row = Record<string, unknown>;
type Dashboard = {
  advertiser: { status: string; policyVersion: string };
  campaigns: Row[]; creatives: Row[]; appeals: Row[]; reports: Row[]; creativeAnalytics: Row[];
  recommendations: Array<{ creativeVersionId: string; severity: string; code: string; message: string }>;
  budgetAlerts: Array<{ campaignId: string; severity: string; message: string }>;
  reportComparison: Row; privacyThreshold: number;
};
const text = (row: Row, key: string) => String(row[key] ?? "");
const number = (row: Row, key: string) => Number(row[key]) || 0;
const yen = (micros: unknown) => `¥${Math.round(Number(micros || 0) / 1_000_000).toLocaleString("ja-JP")}`;
const delta = (current: number, previous: number) => previous > 0 ? `${current >= previous ? "+" : ""}${((current / previous - 1) * 100).toFixed(1)}%` : current > 0 ? "新規" : "±0%";
type AdvertiserAction = "connect" | "appeal" | "campaign" | "creative" | "logout";

export function AdvertiserDashboard() {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [data, setData] = useState<Dashboard | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"status" | "error">("status");
  const [busyAction, setBusyAction] = useState<AdvertiserAction | null>(null);
  const actionLock = useRef(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "connect" | "error">("loading");
  const busy = busyAction !== null;
  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const response = await fetch("/api/ads/advertiser/dashboard", { cache: "no-store" });
      if (response.ok) {
        setData(await response.json() as Dashboard);
        setLoadState("ready");
      } else if (response.status === 401 || response.status === 403) {
        setData(null);
        setLoadState("connect");
      } else {
        setLoadState("error");
      }
    } catch {
      setLoadState("error");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const runAction = async (
    action: AdvertiserAction,
    failureMessage: string,
    task: () => Promise<void>,
  ) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusyAction(action);
    setMessage("");
    try {
      await task();
    } catch {
      setMessageTone("error");
      setMessage(`${failureMessage} 通信状態を確認して、もう一度お試しください。`);
    } finally {
      actionLock.current = false;
      setBusyAction(null);
    }
  };

  const connect = async () => {
    await runAction("connect", "広告主アカウントを接続できませんでした。", async () => {
      let link = await fetch("/account/api/v1/links/hub-ads", { credentials: "same-origin", cache: "no-store" });
      if (!link.ok) link = await fetch("/account/api/v1/links/hub-ads", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      if (!link.ok) throw new Error("Accountへのログインまたは再認証が必要です。");
      const issued = await fetch("/account/api/v1/assertions/hub-ads", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await issued.json().catch(() => null) as { assertion?: string } | null;
      if (!issued.ok || !body?.assertion) throw new Error("広告管理用の認証を取得できませんでした。");
      const exchange = await fetch("/api/ads/advertiser/session", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ assertion: body.assertion, acceptPolicy: true }) });
      if (!exchange.ok) throw new Error("広告主セッションを開始できませんでした。");
      await load();
    });
  };

  const appeal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const [targetType, targetId] = String(form.get("target")).split(":");
    await runAction("appeal", "再審査を申請できませんでした。入力内容は保持されています。", async () => {
      const response = await fetch("/api/ads/advertiser/appeals", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetType, targetId, reason: String(form.get("reason")) }) });
      if (!response.ok) throw new Error("appeal_failed");
      setMessageTone("status");
      setMessage("再審査を申請しました。");
      formElement.reset();
      await load();
    });
  };

  const resubmitCampaign = async (id: string) => {
    await runAction("campaign", "キャンペーンを再提出できませんでした。", async () => {
      const response = await fetch(`/api/ads/advertiser/campaigns/${encodeURIComponent(id)}/resubmit`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("campaign_resubmit_failed");
      setMessageTone("status");
      setMessage("キャンペーンを再提出しました。");
      await load();
    });
  };

  const resubmitCreative = async (event: FormEvent<HTMLFormElement>, id: string, row: Row) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction("creative", "素材を再提出できませんでした。入力内容は保持されています。", async () => {
      const response = await fetch(`/api/ads/advertiser/creatives/${encodeURIComponent(id)}/resubmit`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({
        headline: String(form.get("headline")), description: String(form.get("description")), callToAction: String(form.get("callToAction")),
        landingUrl: String(form.get("landingUrl")), advertiserDisplayName: String(form.get("advertiserDisplayName")), language: "ja",
        assetId: row.assetId,
      }) });
      if (!response.ok) throw new Error("creative_resubmit_failed");
      setMessageTone("status");
      setMessage("修正版の素材を再提出しました。");
      await load();
    });
  };

  const logout = async () => {
    await runAction("logout", "ログアウトできませんでした。広告管理の接続は維持されています。", async () => {
      const response = await fetch("/api/ads/advertiser/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("logout_failed");
      setMessage("");
      setData(null);
      setLoadState("connect");
    });
  };

  if (loadState === "loading") return <UiStatePanel className={styles.connect} state="loading" title="広告管理を読み込んでいます" />;
  if (loadState === "error") return <UiStatePanel className={styles.connect} state="error" title="広告管理を読み込めませんでした" description="通信状態を確認して、もう一度お試しください。" action={<UiButton type="button" onClick={() => void load()}>再試行</UiButton>} />;
  if (!data) return <UiStatePanel className={styles.connect} state={message ? "error" : "forbidden"} title="広告主アカウントを接続" description={message || "Accountから広告専用の匿名IDで接続します。Hubには氏名、メール、KYC情報を保存しません。"} action={<UiButton tone="primary" type="button" pending={busy} pendingLabel="接続中…" onClick={() => void connect()}>Accountを接続</UiButton>} />;
  const c = data.reportComparison, currentServed = number(c, "currentServed"), previousServed = number(c, "previousServed"), currentClicked = number(c, "currentClicked"), previousClicked = number(c, "previousClicked");
  return <section className={styles.dashboard}>
    <header><div><span>ADVERTISER DASHBOARD</span><p>キャンペーンの作成から改善までを管理します。</p></div><div className={styles.headerActions}><a href={hubSurfacePath(surface, "/advertising/library")}>広告ライブラリ</a><button type="button" disabled={busy} onClick={() => void logout()}>{busyAction === "logout" ? "ログアウト中…" : "ログアウト"}</button></div></header>
    {message ? <p className={styles.notice} role={messageTone === "error" ? "alert" : "status"}>{message}</p> : null}
    {data.advertiser.status === "active" ? <AdvertiserCampaignWizard onCreated={load} /> : <section><h2>運営確認中</h2><p>広告主審査が完了すると広告を作成できます。</p></section>}
    {data.budgetAlerts.length ? <section><h2>予算のお知らせ</h2>{data.budgetAlerts.map((alert) => <article key={alert.campaignId} data-severity={alert.severity}><strong>{alert.severity === "critical" ? "予算終了" : "残高注意"}</strong><p>{alert.message}</p></article>)}</section> : null}
    <section id="campaigns"><h2>キャンペーン</h2>{data.campaigns.length ? data.campaigns.map((row) => {
      const state = row.displayState as Row | undefined, forecast = row.budgetForecast as Row | undefined;
      return <article key={text(row, "id")}><div className={styles.rowHeading}><strong>{text(row, "campaignName")}</strong><span className={styles.badge}>{text(state ?? {}, "label")}</span></div><p>次の操作: {text(state ?? {}, "nextAction")}</p>
        <small>消化 {yen(row.spentJpyMicros)} / {yen(row.totalBudgetJpyMicros)} · 残り {yen(forecast?.remainingJpyMicros)}</small>
        {row.reviewReason ? <p className={styles.reason}>審査理由: {text(row, "reviewReason")}</p> : null}
        {row.reviewStatus === "needs_changes" ? <button disabled={busy} onClick={() => void resubmitCampaign(text(row, "id"))}>{busyAction === "campaign" ? "再提出中…" : "修正済みとして再提出"}</button> : null}</article>;
    }) : <p>キャンペーンはまだありません。</p>}</section>
    <section id="reports"><h2>直近7日とその前の7日</h2><div className={styles.metrics}><article><small>表示</small><strong>{currentServed.toLocaleString("ja-JP")}</strong><span>{delta(currentServed, previousServed)}</span></article><article><small>クリック</small><strong>{currentClicked.toLocaleString("ja-JP")}</strong><span>{delta(currentClicked, previousClicked)}</span></article><article><small>費用</small><strong>{yen(c.currentSpend)}</strong><span>{delta(number(c, "currentSpend"), number(c, "previousSpend"))}</span></article></div><p>{data.privacyThreshold}配信未満の細かな内訳はプライバシー保護のため表示しません。</p></section>
    <section><h2>改善提案</h2>{data.recommendations.length ? data.recommendations.map((item) => <article key={`${item.creativeVersionId}:${item.code}`}><strong>{item.severity === "warning" ? "優先して確認" : "改善候補"}</strong><p>{item.message}</p></article>) : <p>現在、優先度の高い改善候補はありません。</p>}</section>
    <section><h2>素材と審査結果</h2>{data.creatives.length ? data.creatives.map((row) => <article key={text(row, "id")}><div className={styles.rowHeading}><strong>{text(row, "headline")}</strong><span>{text(row, "reviewStatus")}</span></div><p>{text(row, "description")}</p>{row.reviewReason ? <p className={styles.reason}>修正内容: {text(row, "reviewReason")}</p> : null}
      {["needs_changes", "rejected"].includes(text(row, "reviewStatus")) ? <form className={styles.form} onSubmit={(event) => void resubmitCreative(event, text(row, "id"), row)}>
        <label>広告主名<UiInput name="advertiserDisplayName" defaultValue={text(row, "advertiserDisplayName")} required /></label><label>見出し<UiInput name="headline" defaultValue={text(row, "headline")} required maxLength={120} /></label>
        <label className={styles.full}>説明<UiTextarea name="description" defaultValue={text(row, "description")} maxLength={500} /></label><label>ボタン文言<UiInput name="callToAction" defaultValue={text(row, "callToAction")} required /></label>
        <label>リンク先<UiInput name="landingUrl" type="url" defaultValue={text(row, "landingUrl")} required /></label><UiButton tone="primary" disabled={busy} pending={busyAction === "creative"} pendingLabel="再提出中…">修正版を再提出</UiButton>
      </form> : null}</article>) : <p>素材はまだありません。</p>}</section>
    <section><h2>再審査</h2><form className={styles.form} onSubmit={appeal}><label>対象<UiSelect name="target" required><option value="">選択してください</option>{data.campaigns.map((row) => <option key={text(row, "id")} value={`campaign:${text(row, "id")}`}>キャンペーン: {text(row, "campaignName")}</option>)}{data.creatives.map((row) => <option key={text(row, "id")} value={`creative:${text(row, "id")}`}>素材: {text(row, "headline")}</option>)}</UiSelect></label><label className={styles.full}>修正した内容<UiTextarea name="reason" minLength={20} maxLength={2000} required /></label><UiButton tone="primary" disabled={busy} pending={busyAction === "appeal"} pendingLabel="申請中…">再審査を申請</UiButton></form></section>
  </section>;
}
