"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useHubWallet } from "@/components/hub-wallet-provider";
type Exception = {
  id: string;
  orderId: string;
  transactionHash: string;
  expectedAtomic: string;
  observedAtomic: string;
  exceptionType: "underpaid" | "overpaid";
  status: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolutionReference: string | null;
  payoutWallet?: string;
  /* 過払い解消用のサーバー生成送金spec（宛先・額・calldata固定済み）。 */
  resolutionTransfer?: {
    chainId: number;
    from: string;
    to: string;
    value: `0x${string}`;
    data: `0x${string}`;
    amountAtomic: string;
  } | null;
};
const API = "/shopping/api/commerce/api/v1/seller/payment-exceptions";
export function MerchantPaymentExceptions() {
  const wallet = useHubWallet();
  const [items, setItems] = useState<Exception[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(API, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { exceptions: Exception[] };
    setItems(body.exceptions);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function resolve(event: FormEvent<HTMLFormElement>, item: Exception) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget),
      transactionHash = String(form.get("transactionHash") ?? "").trim();
    try {
      const response = await fetch(`${API}/${item.id}/resolve`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transactionHash }),
        }),
        body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "解消を確認できませんでした。");
      await load();
      setMessage(
        item.exceptionType === "underpaid"
          ? "追加入金を確認し、注文を確定しました。"
          : "過払い分の返金を確認し、注文を確定しました。",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "解消を確認できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  /* 過払いの差額返送。specはサーバー生成——宛先は購入者ウォレット、
     送信元は店舗の受取ウォレットでないと照合が通らない。 */
  async function refundOverpaid(item: Exception) {
    const spec = item.resolutionTransfer;
    if (!spec) return;
    setBusy(true);
    setMessage("");
    try {
      if (!wallet.address && !(await wallet.connect()))
        throw new Error("ウォレットへ接続できません。");
      if (
        spec.from &&
        wallet.address &&
        wallet.address.toLowerCase() !== spec.from.toLowerCase()
      )
        throw new Error(
          "接続中のウォレットは店舗の受取ウォレットと違います。登録したウォレットに切り替えてください。",
        );
      await wallet.switchChain(spec.chainId);
      const transactionHash = await wallet.sendContractTransactionWithValue(
        spec.to,
        spec.data,
        spec.value,
      );
      let lastError = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (attempt)
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const response = await fetch(`${API}/${item.id}/resolve`, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ transactionHash }),
          }),
          body = (await response.json()) as { error?: string };
        if (response.ok) {
          lastError = "";
          break;
        }
        lastError = body.error ?? "解消を確認できませんでした。";
        if (lastError !== "transaction_not_confirmed") break;
      }
      if (lastError)
        throw new Error(
          lastError === "transaction_not_confirmed"
            ? "送信済みですが、確定監視が時間内に完了しませんでした。"
            : lastError,
        );
      await load();
      setMessage("過払い分の返金を確認し、注文を確定しました。");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "返金を完了できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!items.length) return null;
  return (
    <section className="commerce-payment-exceptions">
      <header>
        <div>
            <h2>入金差額の確認</h2>
          <p>
            不足払いと過払いは通常売上へ混ぜず、差額処理が確認できるまで隔離されます。
          </p>
        </div>
        <b>{items.filter((v) => v.status === "open").length}件</b>
      </header>
      {message ? <p role="status">{message}</p> : null}
      <div>
        {items.map((item) => {
          const difference =
            BigInt(item.expectedAtomic) - BigInt(item.observedAtomic);
          return (
            <article key={item.id}>
              <h3>
                {item.exceptionType === "underpaid" ? "不足払い" : "過払い"}
              </h3>
              <dl>
                <div>
                  <dt>注文</dt>
                  <dd>{item.orderId.slice(0, 8)}</dd>
                </div>
                <div>
                  <dt>期待額</dt>
                  <dd>{item.expectedAtomic}</dd>
                </div>
                <div>
                  <dt>確認額</dt>
                  <dd>{item.observedAtomic}</dd>
                </div>
                <div>
                  <dt>差額（最小単位）</dt>
                  <dd>
                    {(difference < 0n ? -difference : difference).toString()}
                  </dd>
                </div>
                <div>
                  <dt>状態</dt>
                  <dd>{item.status}</dd>
                </div>
              </dl>
              {item.status === "open" ? (
                <>
                  {item.exceptionType === "overpaid" &&
                  item.resolutionTransfer ? (
                    <button
                      disabled={busy}
                      onClick={() => void refundOverpaid(item)}
                    >
                      ウォレットで差額を返送して解消
                    </button>
                  ) : null}
                  <form onSubmit={(event) => void resolve(event, item)}>
                    <label>
                      {item.exceptionType === "underpaid"
                        ? "購入者から店舗への追加入金Tx"
                        : "店舗から購入者への差額返金Tx"}
                      <input
                        name="transactionHash"
                        required
                        pattern="0x[0-9a-fA-F]{64}"
                        autoComplete="off"
                        placeholder="0x…"
                      />
                    </label>
                    <button disabled={busy}>チェーン上で確認して解消</button>
                  </form>
                </>
              ) : item.resolutionReference ? (
                <p>解消Tx：{item.resolutionReference.slice(0, 10)}…</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
