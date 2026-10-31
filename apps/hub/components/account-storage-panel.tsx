"use client";

// 使用量のメーター（PLAN.md §6.1）。合計の正本は Account。ハブのサーバーが読み出して返す。
// 読めないときは 0 と出さず「読み込めません」と出す。80% と上限で帯を出す。

import React, { useCallback, useEffect, useState } from "react";

import "./storage-plans.css";
import { AUTOPAY_STOPPED_KEY, StorageAutopay, StorageAutopayStatus } from "@/components/storage-autopay";
import { StoragePlanPurchase } from "@/components/storage-plan-purchase";
import type { HubLocale } from "@/lib/i18n";
import {
  STORAGE_STATUS_PATH,
  formatStorageBytes,
  parseStorageStatus,
  planUntilLabel,
  storageLevel,
  type StorageMeterStatus,
} from "@/lib/storage-plans";

const SERVICE_LABELS: Record<string, { ja: string; en: string }> = {
  hub: { ja: "Hubの画像・動画", en: "Hub images and video" },
  music: { ja: "音楽", en: "Music" },
  vault: { ja: "ファイル", en: "Files" },
  video: { ja: "動画", en: "Video" },
};

export function AccountStoragePanel({ locale }: { locale: HubLocale }) {
  const ja = locale === "ja";
  const [storage, setStorage] = useState<StorageMeterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [buying, setBuying] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // 利用者がこのセッションで自動更新を止めたときは、Hub に伝えて「止まりました」の通知を出さない。
      let stopped = false;
      try { stopped = window.sessionStorage.getItem(AUTOPAY_STOPPED_KEY) === "1"; } catch { /* 無くても動く */ }
      const response = await fetch(stopped ? `${STORAGE_STATUS_PATH}?userStopped=1` : STORAGE_STATUS_PATH, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("storage_unavailable");
      const parsed = parseStorageStatus(await response.json());
      if (!parsed) throw new Error("storage_malformed");
      setStorage(parsed);
      if (stopped && parsed.renewal === "manual") {
        try { window.sessionStorage.removeItem(AUTOPAY_STOPPED_KEY); } catch { /* 無くても動く */ }
      }
    } catch {
      setStorage(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="account-storage-meter" role="status">
        <strong>{ja ? "保存容量を確認しています…" : "Checking storage capacity…"}</strong>
      </div>
    );
  }

  if (error || !storage) {
    return (
      <div className="account-storage-meter__state" role="alert">
        <strong>{ja ? "読み込めません" : "Could not be loaded"}</strong>
        <p>{ja ? "保存容量を確かめられませんでした。確かめられるまで、新しいアップロードは止まることがあります。" : "Storage capacity could not be verified. New uploads may pause until it can."}</p>
        <div className="account-storage-meter__actions">
          <button type="button" onClick={() => void load()}>{ja ? "再読み込み" : "Reload"}</button>
        </div>
      </div>
    );
  }

  const level = storageLevel(storage.usedBytes, storage.limitBytes);
  const percentage = Math.min(100, Math.round((storage.usedBytes / storage.limitBytes) * 100));
  const until = planUntilLabel(storage.planUntil, locale);
  const planName = storage.planCode === "free" ? (ja ? "無料" : "Free") : ja ? `プラン ${storage.planCode}` : `Plan ${storage.planCode}`;

  return (
    <div className="account-storage-meter" data-level={level}>
      <header>
        <div>
          <span>
            {planName}
            {storage.state === "grace" ? (ja ? "（猶予期間）" : " (grace period)") : ""}
            {until && storage.planCode !== "free" ? (ja ? ` ・ ${until} まで` : ` · until ${until}`) : ""}
          </span>
          <strong>{formatStorageBytes(storage.usedBytes, locale)} / {formatStorageBytes(storage.limitBytes, locale)}</strong>
        </div>
        <b>{percentage}%</b>
      </header>
      <div
        className="account-storage-meter__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-label={ja ? "共通ストレージ使用率" : "Shared storage usage"}
      >
        <i style={{ width: `${percentage}%` }} />
      </div>
      {level !== "normal" ? (
        <p className="account-storage-meter__banner" data-level={level} role="status">
          {level === "full"
            ? ja
              ? "容量の上限に達しています。新しいアップロードは止まっています。ファイルは消えません。"
              : "You have reached your limit. New uploads are paused. Your files are not deleted."
            : ja
              ? "容量が上限の80%に達しました。"
              : "You have used 80% of your capacity."}
        </p>
      ) : (
        <p className="account-storage-meter__banner" data-level="normal">
          {ja ? `残り ${formatStorageBytes(storage.remainingBytes, locale)}。画像・音楽・動画・ファイルで共有する容量です。` : `${formatStorageBytes(storage.remainingBytes, locale)} left, shared by images, music, video, and files.`}
        </p>
      )}
      {storage.byService.length ? (
        <ul className="account-storage-meter__services">
          {storage.byService.map((item) => (
            <li key={item.service}>
              <span>{SERVICE_LABELS[item.service]?.[ja ? "ja" : "en"] ?? item.service}</span>
              <b>{formatStorageBytes(item.committedBytes + item.reservedBytes, locale)}</b>
            </li>
          ))}
        </ul>
      ) : null}
      {storage.renewal === "auto" ? (
        <StorageAutopayStatus locale={locale} nextRenewalAt={storage.nextRenewalAt} onChanged={() => void load()} />
      ) : null}
      {buying ? (
        <StoragePlanPurchase locale={locale} onClose={() => setBuying(false)} onPurchased={() => void load()} />
      ) : autoOpen ? (
        <StorageAutopay locale={locale} onClose={() => setAutoOpen(false)} onStarted={() => void load()} />
      ) : (
        <div className="account-storage-meter__actions">
          <button type="button" onClick={() => setBuying(true)}>{ja ? "容量を増やす" : "Add capacity"}</button>
          {storage.renewal !== "auto" ? (
            <button type="button" onClick={() => setAutoOpen(true)}>{ja ? "自動で更新する" : "Renew automatically"}</button>
          ) : null}
        </div>
      )}
    </div>
  );
}
