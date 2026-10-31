"use client";

import React, { useState } from "react";
import type { CreatorRevenueSummary } from "@/lib/server/d1-creator-revenue";

function yenFromMicros(value: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 })
    .format(Math.floor(value / 1_000_000));
}

export function MonetizationDashboard({ initialSummary }: { initialSummary: CreatorRevenueSummary }) {
  const [summary, setSummary] = useState(initialSummary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function toggleParticipation() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/monetization", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participationEnabled: !summary.participationEnabled }),
      });
      const payload = await response.json() as CreatorRevenueSummary & { error?: string };
      if (!response.ok) throw new Error(payload.error || "参加設定を更新できませんでした。");
      setSummary(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "参加設定を更新できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  return <div className="monetization-dashboard">
    <section className="monetization-dashboard__balance" aria-label="収益概要">
      <div><span>確定収益</span><strong>{yenFromMicros(summary.finalizedAmountMicros)}</strong></div>
      <div><span>集計中</span><strong>{yenFromMicros(summary.draftAmountMicros)}</strong></div>
      <div><span>確定期間</span><strong>{summary.finalizedPeriods}</strong></div>
      <div><span>適格表示単位</span><strong>{summary.eligibleUnits.toLocaleString("ja-JP")}</strong></div>
    </section>
    <section className="monetization-dashboard__participation">
      <div><h2>クリエイター収益分配</h2><strong data-active={summary.participationEnabled}>{summary.participationEnabled ? "参加中" : "未参加"}</strong></div>
      <p>参加中の公開コンテンツの適格収益を集計します。</p>
      <button type="button" onClick={toggleParticipation} disabled={saving}>
        {saving ? "更新中…" : summary.participationEnabled ? "参加を停止する" : "収益分配に参加する"}
      </button>
      {error ? <p role="alert" className="monetization-dashboard__error">{error}</p> : null}
    </section>
    <section className="monetization-dashboard__notice">
      <h2>分配方法</h2>
      <p>純収益の70%をクリエイター、30%を運営に配分します。</p>
      <p>出金、本人確認、税務情報、振込先の登録はまだ開始していません。</p>
    </section>
  </div>;
}
