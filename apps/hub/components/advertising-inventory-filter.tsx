"use client";

import React, { useMemo, useState } from "react";
import {
  filterAdvertisingInventory,
  type AdvertisingInventoryItem,
  type AdvertisingInventoryProvider,
  type AdvertisingInventoryStatus,
} from "@/lib/advertising-inventory";
import type { HubAdPlacement } from "@/lib/advertising";

const PLACEMENTS: Array<{ value: HubAdPlacement; label: string }> = [
  { value: "home", label: "ホーム" },
  { value: "hubpedia-index", label: "Hubpedia一覧" },
  { value: "hubpedia-article", label: "記事上部" },
  { value: "hubpedia-article-bottom", label: "長文記事下部" },
];
const PROVIDERS: Array<{ value: AdvertisingInventoryProvider; label: string }> = [
  { value: "adsense", label: "AdSense" },
  { value: "direct-sponsor", label: "独自スポンサー" },
];
const STATUSES: Array<{ value: AdvertisingInventoryStatus; label: string }> = [
  { value: "active", label: "配信中" },
  { value: "scheduled", label: "予約" },
  { value: "expired", label: "終了" },
];

function statusLabel(status: AdvertisingInventoryStatus): string {
  return STATUSES.find((item) => item.value === status)?.label ?? status;
}

function placementLabel(placement: HubAdPlacement): string {
  return PLACEMENTS.find((item) => item.value === placement)?.label ?? placement;
}

function dateLabel(timestamp: number | undefined): string {
  return timestamp === undefined ? "指定なし" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(timestamp);
}

export function AdvertisingInventoryFilter({ inventory }: { inventory: AdvertisingInventoryItem[] }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<AdvertisingInventoryProvider | "all">("all");
  const [placement, setPlacement] = useState<HubAdPlacement | "all">("all");
  const [status, setStatus] = useState<AdvertisingInventoryStatus | "all">("all");
  const [locale, setLocale] = useState("all");
  const [minimumCpm, setMinimumCpm] = useState("");
  const locales = useMemo(() => [...new Set(inventory.flatMap((item) => item.locales))].sort(), [inventory]);
  const filtered = useMemo(() => filterAdvertisingInventory(inventory, {
    query,
    provider,
    placement,
    status,
    locale,
    minimumCpmJpy: minimumCpm ? Number(minimumCpm) : 0,
  }), [inventory, locale, minimumCpm, placement, provider, query, status]);

  return <div className="ad-inventory">
    <section className="ad-inventory__filters" aria-label="広告インベントリーフィルタ">
      <label className="ad-inventory__search"><span>検索</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="案件名・キーワード・枠ID" /></label>
      <label><span>広告種別</span><select value={provider} onChange={(event) => setProvider(event.target.value as AdvertisingInventoryProvider | "all")}><option value="all">すべて</option>{PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label><span>掲載枠</span><select value={placement} onChange={(event) => setPlacement(event.target.value as HubAdPlacement | "all")}><option value="all">すべて</option>{PLACEMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label><span>状態</span><select value={status} onChange={(event) => setStatus(event.target.value as AdvertisingInventoryStatus | "all")}><option value="all">すべて</option>{STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label><span>言語</span><select value={locale} onChange={(event) => setLocale(event.target.value)}><option value="all">すべて</option>{locales.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>最低想定CPM</span><input type="number" min="0" step="1" value={minimumCpm} onChange={(event) => setMinimumCpm(event.target.value)} placeholder="¥0" /></label>
      <button type="button" onClick={() => { setQuery(""); setProvider("all"); setPlacement("all"); setStatus("all"); setLocale("all"); setMinimumCpm(""); }}>クリア</button>
    </section>

    <div className="ad-inventory__summary"><strong>{filtered.length}</strong><span> / {inventory.length}枠を表示</span></div>
    <div className="ad-inventory__list">
      {filtered.map((item) => <article key={item.id} className="ad-inventory__item">
        <div className="ad-inventory__item-heading">
          <div><span>{item.provider === "adsense" ? "AdSense" : "独自スポンサー"}</span><h2>{item.title}</h2></div>
          <strong data-status={item.status}>{statusLabel(item.status)}</strong>
        </div>
        <dl>
          <div><dt>掲載枠</dt><dd>{placementLabel(item.placement)}</dd></div>
          <div><dt>想定CPM</dt><dd>{item.expectedCpmJpy === undefined ? "未設定" : `¥${item.expectedCpmJpy.toLocaleString("ja-JP")}`}</dd></div>
          <div><dt>言語</dt><dd>{item.locales.length ? item.locales.join(", ") : "全言語"}</dd></div>
          <div><dt>期間</dt><dd>{dateLabel(item.startsAt)}〜{dateLabel(item.endsAt)}</dd></div>
        </dl>
        {item.keywords.length ? <p className="ad-inventory__keywords">{item.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</p> : null}
      </article>)}
      {filtered.length === 0 ? <p className="ad-inventory__empty">条件に一致する広告枠はありません。</p> : null}
    </div>
  </div>;
}

export function AdvertisingInventoryLogin() {
  const [key, setKey] = useState("");
  const [totp, setTotp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/moderation/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, totp }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "管理者認証に失敗しました。");
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "管理者認証に失敗しました。");
      setSubmitting(false);
    }
  }

  return <form className="ad-inventory-login" onSubmit={submit}>
    <label><span>管理キー</span><input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoComplete="current-password" required /></label>
    <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? "認証中…" : "広告管理を開く"}</button>
    <label><span>Google Authenticatorコード</span><input type="text" value={totp} onChange={(event) => setTotp(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required /></label>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
