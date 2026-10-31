"use client";

import { useCallback, useEffect, useState } from "react";

type Readiness = {
  ready: boolean;
  walletReady: boolean;
  walletChainId: number | null;
  activePickupProducts: number;
  openPaymentExceptions: number;
  pendingOrders: number;
  lastPaidAt: string | null;
  paymentsEnabled: boolean;
  testnetOnly: boolean;
  emergencyStop: boolean;
  rolloutMode: string | null;
};

const API = "/shopping/api/commerce/api/v1/seller/pos-readiness";

export function MerchantPosReadiness() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(API, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("運用状態を取得できませんでした。");
      const body = (await response.json()) as { readiness: Readiness };
      setReadiness(body.readiness);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "運用状態を取得できませんでした。",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!readiness)
    return (
      <section className="commerce-pos" aria-labelledby="pos-readiness-title">
        <h2 id="pos-readiness-title">レジ運用チェック</h2>
        <p role="status">{message || "確認しています…"}</p>
      </section>
    );
  const operational =
    readiness.ready &&
    readiness.paymentsEnabled &&
    !readiness.emergencyStop;
  return (
    <section className="commerce-pos" aria-labelledby="pos-readiness-title">
      <header className="commerce-pos-header">
        <div>
          <small>POS READINESS</small>
          <h2 id="pos-readiness-title">レジ運用チェック</h2>
          <p>
            {operational
              ? "レジ決済を受け付けられます。"
              : "未完了の項目があるため、決済受付は停止中です。"}
          </p>
        </div>
        <button type="button" onClick={() => void load()}>
          再確認
        </button>
      </header>
      <dl>
        <div>
          <dt>店舗ウォレット</dt>
          <dd>
            {readiness.walletReady
              ? `接続済み · Chain ${readiness.walletChainId}`
              : "未接続"}
          </dd>
        </div>
        <div>
          <dt>店頭商品</dt>
          <dd>{readiness.activePickupProducts}件</dd>
        </div>
        <div>
          <dt>決済受付</dt>
          <dd>
            {readiness.emergencyStop
              ? "緊急停止中"
              : readiness.paymentsEnabled
                ? "有効"
                : "停止中"}
          </dd>
        </div>
        <div>
          <dt>環境</dt>
          <dd>
            {readiness.testnetOnly
              ? "テストネット"
              : readiness.rolloutMode === "canary"
                ? "本番カナリア"
                : "本番"}
          </dd>
        </div>
        <div>
          <dt>確認待ち注文</dt>
          <dd>{readiness.pendingOrders}件</dd>
        </div>
        <div>
          <dt>要対応決済</dt>
          <dd>{readiness.openPaymentExceptions}件</dd>
        </div>
      </dl>
      {readiness.lastPaidAt ? (
        <p>
          最終入金確認：
          {new Date(readiness.lastPaidAt).toLocaleString("ja-JP")}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

