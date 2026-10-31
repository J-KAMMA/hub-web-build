"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { inspectHubAdCreative } from "@/lib/hub-ads-preflight";
import styles from "./advertiser-dashboard.module.css";

type Placement = { id: string; placementKey: string; displayName: string; surfaceType: string; format: "native" | "static_display" | "sponsored_search" | "text" | "sponsorship"; pageCategory: string };
type Draft = {
  campaignName: string; objective: string; totalBudget: string; dailyBudget: string; startAt: string; endAt: string;
  placementId: string; headline: string; description: string; callToAction: string; landingUrl: string; advertiserDisplayName: string;
};

const initial: Draft = { campaignName: "", objective: "awareness", totalBudget: "", dailyBudget: "", startAt: "", endAt: "", placementId: "", headline: "", description: "", callToAction: "詳しく見る", landingUrl: "", advertiserDisplayName: "" };
type PlacementState = "loading" | "ready" | "empty" | "error";
type SubmissionAttempt = { fingerprint: string; key: string };

export function AdvertiserCampaignWizard({ onCreated }: { onCreated: () => Promise<void> }) {
  const [step, setStep] = useState(1), [draft, setDraft] = useState(initial), [placements, setPlacements] = useState<Placement[]>([]),
    [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [placementState, setPlacementState] = useState<PlacementState>("loading"),
    [placementRetry, setPlacementRetry] = useState(0), [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState(false);
  const submissionLock = useRef(false);
  const attempt = useRef<SubmissionAttempt | null>(null);
  useEffect(() => {
    let mounted = true;
    setPlacementState("loading");
    void (async () => {
      try {
        const response = await fetch("/api/ads/advertiser/wizard", { cache: "no-store" });
        if (!mounted) return;
        if (!response.ok) throw new Error("placements_unavailable");
        const payload = await response.json() as { placements?: Placement[] };
        if (!mounted) return;
        if (!Array.isArray(payload.placements)) throw new Error("invalid_placements");
        setPlacements(payload.placements);
        setPlacementState(payload.placements.length ? "ready" : "empty");
      } catch {
        if (!mounted) return;
        setPlacements([]);
        setPlacementState("error");
      }
    })();
    return () => { mounted = false; };
  }, [placementRetry]);
  const selected = placements.find((item) => item.id === draft.placementId);
  const preflight = useMemo(() => inspectHubAdCreative({
    format: selected?.format ?? "native", headline: draft.headline, description: draft.description, callToAction: draft.callToAction,
    landingUrl: draft.landingUrl, advertiserDisplayName: draft.advertiserDisplayName,
  }), [draft, selected]);
  const update = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const refreshDashboard = async () => {
    setRefreshing(true);
    try {
      await onCreated();
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (step < 4) {
      if (step === 2 && placementState !== "ready") return;
      setStep((current) => current + 1);
      return;
    }
    if (submissionLock.current) return;
    const body = {
      campaignName: draft.campaignName, objective: draft.objective, totalBudgetJpyMicros: Number(draft.totalBudget) * 1_000_000,
      dailyBudgetJpyMicros: Number(draft.dailyBudget) * 1_000_000, startAt: Date.parse(draft.startAt), endAt: Date.parse(draft.endAt),
      placementIds: [draft.placementId], headline: draft.headline, description: draft.description, callToAction: draft.callToAction,
      landingUrl: draft.landingUrl, advertiserDisplayName: draft.advertiserDisplayName, language: "ja",
    };
    const fingerprint = JSON.stringify(body);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    const activeAttempt = attempt.current;
    submissionLock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/ads/advertiser/wizard", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "Idempotency-Key": activeAttempt.key },
        body: fingerprint,
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setMessage(result?.error === "preflight_failed" ? "送信前チェックを確認してください。" : result?.error === "wizard_submission_unconfirmed" ? "提出結果を確認できませんでした。通信状態を確認して、もう一度お試しください。" : "広告を作成できませんでした。通信状態を確認して、もう一度お試しください。");
        return;
      }
      attempt.current = null;
      setDraft(initial);
      setStep(1);
      setMessage("広告を審査へ提出しました。");
      void refreshDashboard();
    } catch {
      setMessage("提出結果を確認できませんでした。通信状態を確認して、もう一度お試しください。");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  };
  return <section>
    <div className={styles.sectionHeading}><div><h2>広告を作成</h2><p>目的、掲載場所、内容、確認の4ステップです。</p></div><strong>{step} / 4</strong></div>
    <div className={styles.steps}>{["目的と予算", "掲載場所", "広告内容", "確認して提出"].map((label, index) => <span key={label} data-active={index + 1 === step}>{index + 1}. {label}</span>)}</div>
    <form className={styles.form} onSubmit={submit}>
      {step === 1 ? <>
        <label>キャンペーン名<input value={draft.campaignName} onChange={(e) => update("campaignName", e.target.value)} required maxLength={160} /></label>
        <label>目的<select value={draft.objective} onChange={(e) => update("objective", e.target.value)}><option value="awareness">認知</option><option value="website_visits">Webサイトへの誘導</option><option value="product_service">商品・サービス</option><option value="event">イベント</option><option value="sponsorship">スポンサー</option></select></label>
        <label>総予算（円）<input type="number" min="1" value={draft.totalBudget} onChange={(e) => update("totalBudget", e.target.value)} required /></label>
        <label>1日の予算（円）<input type="number" min="1" value={draft.dailyBudget} onChange={(e) => update("dailyBudget", e.target.value)} required /></label>
        <label>開始<input type="datetime-local" value={draft.startAt} onChange={(e) => update("startAt", e.target.value)} required /></label>
        <label>終了<input type="datetime-local" value={draft.endAt} onChange={(e) => update("endAt", e.target.value)} required /></label>
      </> : null}
      {step === 2 ? <><label className={styles.full}>掲載場所<select value={draft.placementId} onChange={(e) => update("placementId", e.target.value)} required disabled={placementState !== "ready"}><option value="">選択してください</option>{placements.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.surfaceType}</option>)}</select><small>フィード、フォロー中、リスト、スレッド、動画、音楽、Hubpediaなど、運営が有効にした枠だけを選べます。</small></label>{placementState === "loading" ? <span role="status">掲載枠を読み込んでいます。</span> : null}{placementState === "empty" ? <span role="status">現在選択できる掲載枠はありません。</span> : null}{placementState === "error" ? <span role="alert">掲載枠を読み込めませんでした。<button type="button" className={styles.secondary} disabled={busy} onClick={() => setPlacementRetry((current) => current + 1)}>再試行</button></span> : null}</> : null}
      {step === 3 ? <>
        <label>広告主名<input value={draft.advertiserDisplayName} onChange={(e) => update("advertiserDisplayName", e.target.value)} required maxLength={120} /></label>
        <label>見出し<input value={draft.headline} onChange={(e) => update("headline", e.target.value)} required maxLength={120} /></label>
        <label className={styles.full}>説明<textarea value={draft.description} onChange={(e) => update("description", e.target.value)} maxLength={500} /></label>
        <label>ボタン文言<input value={draft.callToAction} onChange={(e) => update("callToAction", e.target.value)} required maxLength={40} /></label>
        <label>リンク先<input type="url" value={draft.landingUrl} onChange={(e) => update("landingUrl", e.target.value)} placeholder="https://example.com/" required /></label>
      </> : null}
      {step === 4 ? <div className={styles.reviewGrid}>
        <div className={styles.preview}><small>広告</small><strong>{draft.advertiserDisplayName || "広告主名"}</strong><h3>{draft.headline || "見出し"}</h3><p>{draft.description || "広告の説明"}</p><span>{draft.callToAction}</span></div>
        <div><h3>送信前チェック</h3><ul className={styles.checks}>{preflight.checks.map((item) => <li key={item.code} data-status={item.status}><strong>{item.status === "passed" ? "✓" : "!"} {item.label}</strong><span>{item.message}</span></li>)}</ul></div>
      </div> : null}
      <div className={styles.actions}>{step > 1 ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => setStep((current) => current - 1)}>戻る</button> : null}<button disabled={busy || (step === 2 && placementState !== "ready") || (step === 4 && !preflight.passed)}>{step === 4 ? "審査へ提出" : "次へ"}</button></div>
    </form>
    {message ? <p role="status">{message}</p> : null}
    {refreshError ? <p role="alert">広告は審査へ提出済みですが、一覧を更新できませんでした。<button type="button" className={styles.secondary} disabled={refreshing || busy} onClick={() => void refreshDashboard()}>{refreshing ? "更新中…" : "一覧を再試行"}</button></p> : null}
  </section>;
}
