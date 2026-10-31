"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { HubIntentRunSnapshot } from "@/lib/platform/intent-orchestrator";
import {
  UiButton,
  UiLinkButton,
  UiStatePanel,
} from "@/components/ui/primitives";
import { WorkEscrowPanel } from "@/components/work-escrow-panel";
import { IntentRunCenter } from "@/components/intent-run-center";
import styles from "./intent-fulfillment-panel.module.css";

type ApiBody = {
  run?: HubIntentRunSnapshot;
  error?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "access" }
  | { status: "error"; message: string }
  | { status: "ready"; run: HubIntentRunSnapshot };

export function IntentFulfillmentPanel({ intentId }: { intentId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadState({ status: "loading" });
    try {
      const response = await fetch(`/api/core/intents/${encodeURIComponent(intentId)}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      const body = await response.json().catch(() => null) as ApiBody | null;
      if (response.status === 401) {
        setLoadState({ status: "access" });
        return;
      }
      if (!response.ok || !body?.run) {
        throw new Error(
          response.status === 404
            ? "指定されたIntentが見つからないか、このアカウントでは参照できません。Intent作業一覧から選び直してください。"
            : response.status === 503
              ? "Intent履行情報を読み込めませんでした。時間をおいて再試行してください。"
              : "Intent履行情報を読み込めませんでした。",
        );
      }
      if (
        body.run.state !== "handoff_required"
        || body.run.currentStage !== "fulfillment"
        || !body.run.commercePreview
      ) {
        throw new Error("このIntentは履行を開始できる状態ではありません。Intent作業一覧で現在の進行状況を確認してください。");
      }
      setLoadState({ status: "ready", run: body.run });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setLoadState({
        status: "error",
        message: cause instanceof Error
          ? cause.message
          : "Intent履行情報を読み込めませんでした。",
      });
    }
  }, [intentId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const context = <nav className={styles.context} aria-label="パンくず">
    <Link href="/v2/intent">Intent作業</Link>
    <span aria-hidden="true">›</span>
    <span aria-current="page">履行確認</span>
  </nav>;

  if (loadState.status === "loading") return <section className={styles.panel}>
    {context}
    <UiStatePanel state="loading" title="履行情報を読み込んでいます" />
  </section>;

  if (loadState.status === "access") {
    const returnPath = `/v2/intent/${encodeURIComponent(intentId)}/fulfill`;
    return <section className={styles.panel}>
      {context}
      <UiStatePanel
        state="forbidden"
        title="履行情報を見るにはログインが必要です"
        description="Hubへログインすると、このIntentの進行状況と履行内容を確認できます。"
        action={<div className="ui-state-actions">
          <UiLinkButton href={`/v2/auth?next=${encodeURIComponent(returnPath)}`} tone="primary">ログインして履行を続ける</UiLinkButton>
          <UiLinkButton href="/v2/intent">Intent作業へ戻る</UiLinkButton>
        </div>}
      />
    </section>;
  }

  if (loadState.status === "error") return <section className={styles.panel}>
    {context}
    <UiStatePanel
      state="error"
      title="履行情報を読み込めませんでした"
      description={loadState.message}
      action={<div className="ui-state-actions">
        <UiButton type="button" onClick={() => void load()}>再試行</UiButton>
        <UiLinkButton href="/v2/intent">Intent作業へ戻る</UiLinkButton>
      </div>}
    />
  </section>;

  const run = loadState.run;
  const preview = run.commercePreview;
  if (!preview) return null;
  return <section className={styles.panel}>
    {context}
    <IntentRunCenter project="default" focusRunId={run.id} showComposer={false} />
    <section className={styles.summary}>
      <h1>内容を確認して履行する</h1>
      <p>{preview.contractSummary}</p>
      <dl>
        <div><dt>取引種別</dt><dd>{preview.kind}</dd></div>
        <div><dt>相手</dt><dd>{preview.counterparty}</dd></div>
        <div><dt>上限額</dt><dd>{preview.maximumCharge} {preview.currency}</dd></div>
      </dl>
    </section>
    {preview.kind === "work" && preview.currency === "POL"
      ? <WorkEscrowPanel
          listingId={`intent:${run.id}`}
          suggestedBudget={null}
          intentId={run.id}
          suggestedWorkerAddress={preview.recipient}
          suggestedAmountAtomic={preview.maximumCharge}
        />
      : preview.kind === "ai"
        ? <a className={styles.link} href={`/v2/ai?intent=${encodeURIComponent(run.id)}&phase=fulfillment`}>AI実行へ進む</a>
        : <a className={styles.link} href={`${preview.kind === "digital" ? "/v2/market/digital" : "/v2/market"}?intent=${encodeURIComponent(run.id)}`}>商品を確認して決済へ進む</a>}
    {preview.kind === "work" && preview.currency !== "POL"
      ? <p className={styles.notice}>現在のクラウドソーシング用エスクローはPolygon AmoyのPOLに対応しています。</p>
      : null}
  </section>;
}
