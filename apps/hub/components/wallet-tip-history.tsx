"use client";

import { useEffect, useState } from "react";

type HistoryItem = {
  id: string;
  label: string;
  amount: string;
  symbol: string;
  network: string;
  txHash: string;
  explorerUrl: string | null;
  confirmedAt: string;
};

export function WalletTipHistory() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState("履歴を読み込み中…");
  useEffect(() => {
    void Promise.all([
      fetch("/api/tips/history", { cache: "no-store" }),
      fetch("/api/wallet/activity", { cache: "no-store" }),
    ])
      .then(async ([tipsResponse, activityResponse]) => {
        const tips = (await tipsResponse.json()) as {
          tips?: Array<
            Omit<HistoryItem, "label"> & { direction: "received" | "sent" }
          >;
          error?: string;
        };
        const activity = (await activityResponse.json()) as {
          activity?: Array<
            Omit<HistoryItem, "label"> & { type: "transfer" | "contract" }
          >;
          error?: string;
        };
        if (!tipsResponse.ok && !activityResponse.ok)
          throw new Error(
            tips.error || activity.error || "履歴を読み込めませんでした。",
          );
        const merged = [
          ...(tipsResponse.ok
            ? (tips.tips ?? []).map((item) => ({
                ...item,
                label: item.direction === "received" ? "受取" : "投げ銭",
              }))
            : []),
          ...(activityResponse.ok
            ? (activity.activity ?? []).map((item) => ({
                ...item,
                label: item.type === "contract" ? "コントラクト" : "送信",
              }))
            : []),
        ].sort((left, right) =>
          right.confirmedAt.localeCompare(left.confirmedAt),
        );
        setItems(merged);
        setStatus("");
      })
      .catch((error) =>
        setStatus(
          error instanceof Error
            ? error.message
            : "履歴を読み込めませんでした。",
        ),
      );
  }, []);
  return (
    <section
      className="wallet-tip-history"
      aria-labelledby="wallet-tip-history-title"
    >
      <header>
        <div>
          <span>ウォレットの履歴</span>
          <h2 id="wallet-tip-history-title">確認済みの取引履歴</h2>
        </div>
        <small>サーバー側で成功を確認した取引だけを表示します。</small>
      </header>
      {status ? <p role="status">{status}</p> : null}
      {!status && items.length === 0 ? (
        <p>確認済みの取引はまだありません。</p>
      ) : null}
      <div className="wallet-tip-history__list">
        {items.map((item) => (
          <article id={`activity-${item.id}`} key={`${item.label}:${item.id}`}>
            <span>{item.label}</span>
            <strong>
              {item.amount} {item.symbol}
            </strong>
            <small>
              {item.network}・
              <time dateTime={item.confirmedAt}>
                {new Date(item.confirmedAt).toLocaleString("ja-JP")}
              </time>
            </small>
            {item.explorerUrl ? (
              <a href={item.explorerUrl} target="_blank" rel="noreferrer">
                取引を確認
              </a>
            ) : (
              <code>{item.txHash.slice(0, 10)}…</code>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
