"use client";

import React, {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import styles from "./merchant-media-billing-panel.module.css";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

const ENDPOINT = "/shopping/api/commerce/api/v1/seller/media-billing";

type MediaBilling = {
  balance: {
    availableJpyc: number;
    reservedJpyc: number;
    pendingJpyc: number;
    disputeReserveJpyc: number;
    accruedUsageJpyc: number;
    withdrawableJpyc: number;
    currency: string;
  };
  policy: {
    refillThresholdJpyc: number;
    refillBatchJpyc: number;
    singlePaymentLimitJpyc: number;
    dailyPaymentLimitJpyc: number;
    autoRefillEnabled: boolean;
    authorizationExpiresAt: string | null;
  };
  fundingState: "active" | "authorization_required" | "funding_required";
  deliveryAllowed: boolean;
};

const stateLabel = {
  active: "配信可能",
  authorization_required: "支払い承認が必要",
  funding_required: "配信残高が必要",
};

export function MerchantMediaBillingPanel() {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [data, setData] = useState<MediaBilling | null>(null);
  const [message, setMessage] = useState("配信残高を確認しています…");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(ENDPOINT, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("media_billing_unavailable");
    setData((await response.json()) as MediaBilling);
    setMessage("");
  }, []);

  useEffect(() => {
    void load().catch(() =>
      setMessage(
        "配信残高を取得できませんでした。時間をおいて再試行してください。",
      ),
    );
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = {
      refillThresholdJpyc: Number(form.get("refillThresholdJpyc")),
      refillBatchJpyc: Number(form.get("refillBatchJpyc")),
      singlePaymentLimitJpyc: Number(form.get("singlePaymentLimitJpyc")),
      dailyPaymentLimitJpyc: Number(form.get("dailyPaymentLimitJpyc")),
      autoRefillEnabled: form.get("autoRefillEnabled") === "on",
    };
    try {
      const response = await fetch(`${ENDPOINT}/policy`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("policy_not_saved");
      const result = (await response.json()) as {
        authorizationRequired?: boolean;
      };
      setMessage(
        result.authorizationRequired
          ? "上限を保存しました。自動補充を有効にするには、Payment Accountで期限付き支払い権限を承認してください。"
          : "配信残高の設定を保存しました。",
      );
      await load();
    } catch {
      setMessage(
        "設定を保存できませんでした。入力値と大小関係を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <section className={styles.panel}>
        <p className={styles.message} role="status">
          {message}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="media-billing-title">
      <header className={styles.heading}>
        <div>
          <h2 id="media-billing-title">配信残高</h2>
          <p>
            動画保存・配信・AI処理の費用を、Payment
            Accountの収益からまとめて精算します。
          </p>
        </div>
        <span className={styles.status} data-state={data.fundingState}>
          {stateLabel[data.fundingState]}
        </span>
      </header>

      <dl className={styles.balances}>
        <div>
          <dt>利用可能</dt>
          <dd>{data.balance.availableJpyc.toLocaleString()} JPYC</dd>
        </div>
        <div>
          <dt>配信予約</dt>
          <dd>{data.balance.reservedJpyc.toLocaleString()} JPYC</dd>
        </div>
        <div>
          <dt>未精算利用</dt>
          <dd>{data.balance.accruedUsageJpyc.toLocaleString()} JPYC</dd>
        </div>
        <div>
          <dt>引出可能</dt>
          <dd>{data.balance.withdrawableJpyc.toLocaleString()} JPYC</dd>
        </div>
      </dl>

      <form className={styles.policy} onSubmit={save}>
        <label>
          補充を始める残高
          <input
            name="refillThresholdJpyc"
            type="number"
            min="100"
            max="1000000"
            defaultValue={data.policy.refillThresholdJpyc}
          />
        </label>
        <label>
          一度に補充する額
          <input
            name="refillBatchJpyc"
            type="number"
            min="100"
            max="10000000"
            defaultValue={data.policy.refillBatchJpyc}
          />
        </label>
        <label>
          1回の支払い上限
          <input
            name="singlePaymentLimitJpyc"
            type="number"
            min="100"
            max="10000000"
            defaultValue={data.policy.singlePaymentLimitJpyc}
          />
        </label>
        <label>
          1日の支払い上限
          <input
            name="dailyPaymentLimitJpyc"
            type="number"
            min="100"
            max="100000000"
            defaultValue={data.policy.dailyPaymentLimitJpyc}
          />
        </label>
        <label className={styles.toggle}>
          <input
            name="autoRefillEnabled"
            type="checkbox"
            defaultChecked={data.policy.autoRefillEnabled}
          />
          残高が基準を下回ったら、承認済み上限内で配信枠を補充する
        </label>
        <div className={styles.actions}>
          <p className={styles.message} role="status" aria-live="polite">
            {message ||
              (data.deliveryAllowed
                ? "配信を継続できます。"
                : "残高を追加するまで新規配信は開始されません。")}
          </p>
          <span>
            <a href={hubSurfacePath(surface, "/account/payment")}>Payment Accountを確認</a>
            <button type="submit" disabled={busy}>
              {busy ? "保存中…" : "設定を保存"}
            </button>
          </span>
        </div>
      </form>
    </section>
  );
}
