"use client";

import React, { useCallback, useEffect, useState } from "react";

const API = "/shopping/api/commerce/api/v1/seller";

type Analytics = {
  summary: { orders: number; grossJpyc: number; refundedJpyc: number };
  products: Array<{ title: string; quantity: number; grossJpyc: number }>;
  hours: Array<{ hour: string; orders: number; grossJpyc: number }>;
};
type Order = {
  id: string;
  productTitle: string;
  amountJpyc: number;
  amountAtomic: string;
  paymentCurrency: string;
  paymentTokenDecimals: number;
  status: string;
  paidAt: string | null;
  refundId: string | null;
  refundQuoteId: string | null;
  refundStatus: "submitted" | "confirmed" | "rejected" | null;
  refundAmountAtomic: string | null;
  sellerRefundTransactionHash: string | null;
  hubFeeTransactionHash: string | null;
  sellerConfirmedAt: string | null;
  hubFeeConfirmedAt: string | null;
};
type RefundQuote = {
  id: string;
  orderId: string;
  expiresAt: string;
  remainingRefundAmountAtomic: string;
  currency: string;
  paymentTokenDecimals: number;
  sellerAddress: string;
  grossRefundAmountAtomic: string;
  sellerRefundAmountAtomic: string;
  hubFeeRefundAmountAtomic: string;
  hubFeeRefundRequired: boolean;
  completionRule:
    | "seller_and_hub_transfers_confirmed"
    | "seller_transfer_confirmed";
  sellerTransfer: {
    chainId: number;
    to: string;
    value: string;
    data: string;
  };
};
type RefundAttempt = {
  id: string;
  transactionHash: string;
  status: "submitted" | "confirmed" | "rejected";
  failureReason: string | null;
  submittedAt: string;
  resolvedAt: string | null;
};
type EthereumProvider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

function provider(): EthereumProvider | null {
  return (
    (window as Window & { ethereum?: EthereumProvider }).ethereum ?? null
  );
}

function chainHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

function refundRecoveryKey(quoteId: string): string {
  return `hub.commerce.refundTx.${quoteId}`;
}

type RefundRecovery = {
  transactionHash: string;
  quote: RefundQuote | null;
};

function readRefundRecovery(quoteId: string): RefundRecovery | null {
  try {
    const value = window.sessionStorage.getItem(refundRecoveryKey(quoteId));
    if (!value) return null;
    if (/^0x[0-9a-fA-F]{64}$/.test(value))
      return { transactionHash: value, quote: null };
    const parsed = JSON.parse(value) as Partial<RefundRecovery>;
    return typeof parsed.transactionHash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(parsed.transactionHash) &&
      parsed.quote &&
      typeof parsed.quote.id === "string"
      ? {
          transactionHash: parsed.transactionHash,
          quote: parsed.quote as RefundQuote,
        }
      : null;
  } catch {
    return null;
  }
}

function readRefundRecoveryForOrder(orderId: string): RefundRecovery | null {
  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (!key?.startsWith("hub.commerce.refundTx.")) continue;
      const recovery = readRefundRecovery(
        key.slice("hub.commerce.refundTx.".length),
      );
      if (recovery?.quote?.orderId === orderId) return recovery;
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  return null;
}

function writeRefundRecovery(
  quote: RefundQuote,
  transactionHash: string,
): void {
  try {
    window.sessionStorage.setItem(
      refundRecoveryKey(quote.id),
      JSON.stringify({ transactionHash, quote } satisfies RefundRecovery),
    );
  } catch {
    // In-memory state still prevents duplicate submission on the current page.
  }
}

function clearRefundRecovery(quoteId: string): void {
  try {
    window.sessionStorage.removeItem(refundRecoveryKey(quoteId));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function formatAtomicAmount(
  amountAtomic: string | null,
  decimals: number,
): string {
  if (!amountAtomic || !/^\d+$/.test(amountAtomic)) return "0";
  const normalizedDecimals = Math.max(0, Math.min(36, decimals));
  if (normalizedDecimals === 0) return BigInt(amountAtomic).toString();
  const padded = amountAtomic.padStart(normalizedDecimals + 1, "0");
  const integer = padded.slice(0, -normalizedDecimals).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-normalizedDecimals).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

export function MerchantOperationsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderId, setOrderId] = useState("");
  const [amountAtomic, setAmountAtomic] = useState("");
  const [quote, setQuote] = useState<RefundQuote | null>(null);
  const [pendingTransactionHash, setPendingTransactionHash] = useState<
    string | null
  >(null);
  const [refundAttempts, setRefundAttempts] = useState<RefundAttempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [analyticsResponse, ordersResponse] = await Promise.all([
        fetch(`${API}/analytics`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`${API}/orders?purpose=refunds`, {
          credentials: "include",
          cache: "no-store",
        }),
      ]);
      if (!analyticsResponse.ok || !ordersResponse.ok)
        throw new Error("merchant_data_unavailable");
      const analytics = (await analyticsResponse.json()) as Analytics;
      const orderBody = (await ordersResponse.json()) as { orders: Order[] };
      for (const order of orderBody.orders) {
        if (order.refundStatus === "rejected" && order.refundQuoteId)
          clearRefundRecovery(order.refundQuoteId);
      }
      setData(analytics);
      setOrders(orderBody.orders);
      setOrderId(
        (current) =>
          current ||
          orderBody.orders.find(
            (order) =>
              ["paid", "partially_refunded"].includes(order.status) &&
              order.refundStatus !== "submitted",
          )?.id ||
          "",
      );
    } catch {
      setMessage("店舗の売上情報を取得できませんでした。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setQuote(null);
    setPendingTransactionHash(null);
    setRefundAttempts([]);
    setMessage("");
    if (!orderId) return;
    let active = true;
    void fetch(`${API}/orders/${orderId}/refunds/attempts`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("refund_attempts_unavailable");
        return (await response.json()) as { attempts: RefundAttempt[] };
      })
      .then((body) => {
        if (active) setRefundAttempts(body.attempts);
      })
      .catch(() => {
        if (active) setRefundAttempts([]);
      });
    void fetch(`${API}/orders/${orderId}/refunds/quote`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("refund_quote_restore_failed");
        return (await response.json()) as {
          refundQuote: RefundQuote | null;
        };
      })
      .then((body) => {
        if (!active) return;
        const storedRecovery = body.refundQuote
          ? readRefundRecovery(body.refundQuote.id)
          : readRefundRecoveryForOrder(orderId);
        const restoredQuote = body.refundQuote ?? storedRecovery?.quote ?? null;
        if (!restoredQuote) return;
        setQuote(restoredQuote);
        setAmountAtomic(restoredQuote.grossRefundAmountAtomic);
        setPendingTransactionHash(
          storedRecovery?.transactionHash ?? null,
        );
        setMessage(
          storedRecovery?.transactionHash
            ? "送信済みの返金取引を復元しました。ウォレットから再送せず、Commerceへの登録だけを再試行します。"
            : "有効な返金見積を復元しました。内容を確認して送金するか、取り消して作り直してください。",
        );
      })
      .catch(() => {
        if (active)
          setMessage("有効な返金見積を確認できませんでした。再読み込みしてください。");
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  async function createQuote() {
    if (!orderId) {
      setMessage("返金する注文を選択してください。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/orders/${orderId}/refunds/quote`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountAtomic: amountAtomic.trim() || undefined,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        refundQuote?: RefundQuote;
      };
      if (!response.ok || !body.refundQuote)
        throw new Error(body.error ?? "refund_quote_failed");
      setQuote(body.refundQuote);
      setMessage(
        body.refundQuote.hubFeeRefundRequired
          ? "販売者分の送金後、Hubの1%も別送金で購入者へ返します。両方の確認後に返金完了となります。"
          : "この返金は販売者からの送金確認だけで完了します。",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "返金見積を作成できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendRefund() {
    if (!quote) return;
    let transactionHash = pendingTransactionHash;
    const wallet = transactionHash ? null : provider();
    if (!transactionHash && !wallet) {
      setMessage("利用できるウォレットが見つかりません。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (!transactionHash) {
        if (!wallet)
          throw new Error("利用できるウォレットが見つかりません。");
        const accounts = (await wallet.request({
          method: "eth_requestAccounts",
        })) as string[];
        const from = accounts[0];
        if (!from) throw new Error("ウォレットを接続できませんでした。");
        if (from.toLowerCase() !== quote.sellerAddress.toLowerCase())
          throw new Error(
            "接続ウォレットが、この注文の販売者受取ウォレットと一致しません。",
          );
        const currentChain = (await wallet.request({
          method: "eth_chainId",
        })) as string;
        if (
          currentChain.toLowerCase() !==
          chainHex(quote.sellerTransfer.chainId)
        ) {
          await wallet.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: chainHex(quote.sellerTransfer.chainId) }],
          });
        }
        transactionHash = (await wallet.request({
          method: "eth_sendTransaction",
          params: [
            {
              from,
              to: quote.sellerTransfer.to,
              value: quote.sellerTransfer.value,
              data: quote.sellerTransfer.data,
            },
          ],
        })) as string;
        if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))
          throw new Error("返金取引を確認できませんでした。");
        setPendingTransactionHash(transactionHash);
        writeRefundRecovery(quote, transactionHash);
      }

      const response = await fetch(`${API}/orders/${orderId}/refunds`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transactionHash,
          refundQuoteId: quote.id,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        if (body?.error === "refund_transaction_rejected") {
          clearRefundRecovery(quote.id);
          setPendingTransactionHash(null);
          setQuote(null);
          await load();
        }
        throw new Error(body?.error ?? "返金取引を登録できませんでした。");
      }
      clearRefundRecovery(quote.id);
      setPendingTransactionHash(null);
      setMessage(
        quote.hubFeeRefundRequired
          ? "販売者分を送信しました。Hub手数料分の返還とチェーン確定を待っています。"
          : "返金を送信しました。チェーン確定後に注文へ反映します。",
      );
      setQuote(null);
      setAmountAtomic("");
      await load();
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "返金を実行できませんでした。";
      setMessage(
        detail === "refund_transaction_rejected"
          ? "以前の返金取引は不成立または内容不一致でした。返金額を確認して新しい見積を作成してください。"
          : transactionHash
          ? `ウォレット送金は完了しています。再送金せず、登録を再試行してください。${detail}`
          : detail,
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelQuote() {
    if (!quote) return;
    if (pendingTransactionHash) {
      setMessage(
        "送信済み取引があるため見積を取り消せません。返金取引の登録を再試行してください。",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/orders/${orderId}/refunds/quote`, {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refundQuoteId: quote.id }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(body?.error ?? "返金見積を取り消せませんでした。");
      setQuote(null);
      setPendingTransactionHash(null);
      setMessage("返金見積を取り消しました。金額を変更して作り直せます。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "返金見積を取り消せませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="commerce-order-panel" id="merchant-analytics">
      <header>
        <div>
          <small>店舗管理</small>
          <h2>売上と返金</h2>
          <p>
            売上と返金はCommerceの注文記録から集計します。Hubは署名鍵や決済資産を保持しません。
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()}>
          更新
        </button>
      </header>

      {data ? (
        <>
          <dl>
            <div>
              <dt>確定注文</dt>
              <dd>{data.summary.orders.toLocaleString()}件</dd>
            </div>
            <div>
              <dt>総売上</dt>
              <dd>{data.summary.grossJpyc.toLocaleString()} JPYC</dd>
            </div>
            <div>
              <dt>返金</dt>
              <dd>{data.summary.refundedJpyc.toLocaleString()} JPYC</dd>
            </div>
            <div>
              <dt>返金率</dt>
              <dd>
                {data.summary.grossJpyc
                  ? (
                      (data.summary.refundedJpyc / data.summary.grossJpyc) *
                      100
                    ).toFixed(1)
                  : "0.0"}
                %
              </dd>
            </div>
          </dl>
          <div className="commerce-order-list">
            {data.products.slice(0, 5).map((product) => (
              <article key={product.title}>
                <div className="commerce-order-summary">
                  <b>{product.title}</b>
                  <span>{product.quantity}点</span>
                  <strong>{product.grossJpyc.toLocaleString()} JPYC</strong>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      <details>
        <summary>全額・部分返金</summary>
        <p>
          返金額を確認してから、店舗ウォレットで購入者へ直接送金します。Hubの1%は運営ウォレットから別途返還されます。
        </p>
        <label>
          注文
          <select
            value={orderId}
            disabled={busy || quote !== null}
            onChange={(event) => setOrderId(event.target.value)}
          >
            <option value="">選択してください</option>
            {orders
              .filter(
                (order) =>
                  ["paid", "partially_refunded"].includes(order.status) &&
                  order.refundStatus !== "submitted",
              )
              .map((order) => (
                <option key={order.id} value={order.id}>
                  {order.productTitle}・{order.amountJpyc.toLocaleString()} JPYC
                </option>
              ))}
          </select>
        </label>
        <label>
          部分返金の最小単位額（空欄は全額）
          <input
            value={amountAtomic}
            disabled={busy || quote !== null}
            inputMode="numeric"
            onChange={(event) =>
              setAmountAtomic(event.target.value.replace(/\D/g, ""))
            }
          />
        </label>
        <button type="button" disabled={busy || !orderId} onClick={createQuote}>
          返金額を確認
        </button>

        {quote ? (
          <section aria-label="返金内訳">
            <dl>
              <div>
                <dt>購入者への返金総額</dt>
                <dd>
                  {formatAtomicAmount(
                    quote.grossRefundAmountAtomic,
                    quote.paymentTokenDecimals,
                  )}{" "}
                  {quote.currency}
                </dd>
              </div>
              <div>
                <dt>店舗から返す額</dt>
                <dd>
                  {formatAtomicAmount(
                    quote.sellerRefundAmountAtomic,
                    quote.paymentTokenDecimals,
                  )}{" "}
                  {quote.currency}
                </dd>
              </div>
              <div>
                <dt>Hubから返す額</dt>
                <dd>
                  {formatAtomicAmount(
                    quote.hubFeeRefundAmountAtomic,
                    quote.paymentTokenDecimals,
                  )}{" "}
                  {quote.currency}
                </dd>
              </div>
            </dl>
            <button type="button" disabled={busy} onClick={sendRefund}>
              {pendingTransactionHash
                ? "送信済み取引を登録"
                : "ウォレットで店舗分を返金"}
            </button>
            <button
              type="button"
              disabled={busy || pendingTransactionHash !== null}
              onClick={cancelQuote}
            >
              見積を取り消す
            </button>
          </section>
        ) : null}
        {orders.some((order) => order.refundStatus) ? (
          <section aria-label="返金状況">
            <h3>返金状況</h3>
            <div className="commerce-order-list">
              {orders
                .filter((order) => order.refundStatus)
                .map((order) => (
                  <article key={order.refundId ?? order.id}>
                    <div className="commerce-order-summary">
                      <b>{order.productTitle}</b>
                      <span>
                        {order.refundStatus === "confirmed"
                          ? "返金完了"
                          : order.hubFeeTransactionHash
                            ? "オンチェーン照合待ち"
                            : "Hub手数料の返還待ち"}
                      </span>
                      <strong>
                        {formatAtomicAmount(
                          order.refundAmountAtomic,
                          order.paymentTokenDecimals,
                        )}{" "}
                        {order.paymentCurrency}
                      </strong>
                    </div>
                    <small>
                      販売者Tx: {order.sellerRefundTransactionHash}
                      {order.hubFeeTransactionHash
                        ? ` / Hub Tx: ${order.hubFeeTransactionHash}`
                        : ""}
                    </small>
                  </article>
                ))}
            </div>
          </section>
        ) : null}
        {refundAttempts.length ? (
          <section aria-label="返金取引履歴">
            <h3>返金取引履歴</h3>
            <div className="commerce-order-list">
              {refundAttempts.map((attempt) => (
                <article key={attempt.id}>
                  <div className="commerce-order-summary">
                    <b>
                      {attempt.status === "confirmed"
                        ? "確認済み"
                        : attempt.status === "rejected"
                          ? "不成立"
                          : "確認中"}
                    </b>
                    <span>
                      {attempt.status === "rejected"
                        ? refundFailureLabel(attempt.failureReason)
                        : attempt.resolvedAt
                          ? new Date(attempt.resolvedAt).toLocaleString()
                          : new Date(attempt.submittedAt).toLocaleString()}
                    </span>
                  </div>
                  <small>店舗Tx: {attempt.transactionHash}</small>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </details>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function refundFailureLabel(reason: string | null): string {
  switch (reason) {
    case "seller_transaction_reverted":
      return "オンチェーンで失敗";
    case "seller_transfer_mismatch":
      return "送金内容が見積と不一致";
    case "legacy_rejected":
      return "以前の取引は不成立";
    default:
      return "確認できない取引";
  }
}
