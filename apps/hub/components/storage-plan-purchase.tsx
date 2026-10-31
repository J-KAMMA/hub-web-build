"use client";

// 保存容量プランの買う流れ（PLAN.md §6.2）。支払いは Commerce の注文で、ブラウザが Commerce を直接呼ぶ。
// ハブは金額・送金ID・主張を持たない。ウォレットの署名はハブのウォレットの確認画面（eth_sendTransaction）を使う。
// 表示は「保存容量プランの支払い」だけ。交換・価格比較・経路の言葉は出さない。
// 成功の根拠は Commerce の状態と、ハブのサーバー側が読み直す Account の上限だけ。

import React, { useCallback, useEffect, useRef, useState } from "react";

import "./storage-plans.css";
import {
  ACCOUNT_STORAGE_PURCHASE_ASSERTION,
  COMMERCE_LEGAL_PATH,
  COMMERCE_STORAGE_PLANS_BASE,
  erc20TransferData,
  parsePlanListing,
  planBytesLabel,
  type StoragePlanListing,
} from "@/lib/storage-plans";

type Locale = string;
type Token = "JPYC" | "USDC";
type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
type Order = {
  orderId: string;
  orderToken: string;
  description: string;
  planCode: string;
  bytes: number;
  termDays: number;
  priceJpy: number;
  token: Token;
  chainId: number;
  tokenAddress: string;
  payTo: string;
  amountAtomic: string;
  displayAmount: string;
  fx: { rateDate: string; source: string; jpyPerUnitMicros: string } | null;
  expiresAt: string;
};
type Phase = "plans" | "creating" | "confirm" | "paying" | "waiting" | "done" | "failed";

const POLL_MS = 4000;
const POLL_LIMIT = 45;

function walletProvider(): Provider | null {
  const host = window as Window & { hubNativeWallet?: Provider; ethereum?: Provider };
  return host.hubNativeWallet ?? host.ethereum ?? null;
}

const t = (ja: boolean, jaText: string, enText: string) => (ja ? jaText : enText);

export function StoragePlanPurchase({ locale, onClose, onPurchased }: { locale: Locale; onClose: () => void; onPurchased?: () => void }) {
  const ja = locale === "ja";
  const [listing, setListing] = useState<StoragePlanListing | null>(null);
  const [listingError, setListingError] = useState(false);
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [token, setToken] = useState<Token>("JPYC");
  const [age, setAge] = useState(false);
  const [phase, setPhase] = useState<Phase>("plans");
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let active = true;
    fetch(COMMERCE_STORAGE_PLANS_BASE, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("listing"))))
      .then((body) => {
        if (!active) return;
        const parsed = parsePlanListing(body);
        if (!parsed) setListingError(true);
        else setListing(parsed);
      })
      .catch(() => active && setListingError(true));
    return () => {
      active = false;
      cancelled.current = true;
    };
  }, []);

  const plan = listing?.plans.find((p) => p.code === planCode) ?? null;
  const usdcOpen = listing?.tokens?.USDC.available === true;

  const createOrder = useCallback(async () => {
    if (!plan || !age) return;
    setPhase("creating");
    setMessage("");
    try {
      const a = await fetch(ACCOUNT_STORAGE_PURCHASE_ASSERTION, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
      if (!a.ok) throw new Error(a.status === 403 ? "reauth" : "assertion");
      const { assertion } = (await a.json()) as { assertion?: string };
      const r = await fetch(`${COMMERCE_STORAGE_PLANS_BASE}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ assertion, planCode: plan.code, token, ageDeclared18: true }),
      });
      const body = (await r.json().catch(() => null)) as (Order & { error?: string }) | null;
      if (!r.ok || !body || typeof body.orderId !== "string") {
        setMessage(
          body?.error === "usdc_rate_unavailable"
            ? t(ja, "今は USDC で払えません。JPYC なら払えます。", "USDC is unavailable right now. You can pay with JPYC.")
            : t(ja, "注文を作れませんでした。時間をおいて、もう一度お試しください。", "The order could not be created. Please try again later."),
        );
        if (body?.error === "usdc_rate_unavailable") setToken("JPYC");
        setPhase("plans");
        return;
      }
      setOrder(body);
      setPhase("confirm");
    } catch (error) {
      setMessage(
        (error as Error).message === "reauth"
          ? t(ja, "購入には、もう一度ログインして本人確認をしてください。", "Please sign in again to confirm it is you before purchasing.")
          : t(ja, "購入の準備ができませんでした。Account に接続できているか確認してください。", "Purchase could not be prepared. Check that your account is connected."),
      );
      setPhase("plans");
    }
  }, [age, ja, plan, token]);

  const poll = useCallback(async (o: Order) => {
    for (let i = 0; i < POLL_LIMIT; i += 1) {
      if (cancelled.current) return;
      try {
        const r = await fetch(`${COMMERCE_STORAGE_PLANS_BASE}/orders/${o.orderId}?t=${o.orderToken}`, { headers: { accept: "application/json" } });
        const s = (await r.json()) as { status?: string; grantApplied?: boolean };
        if (r.ok && s.status === "paid" && s.grantApplied) {
          setPhase("done");
          onPurchased?.();
          return;
        }
      } catch {
        /* 次の周で読み直す */
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    setMessage(t(ja, "支払いの確認を待っています。ファイルは安全です。あとでこの画面を開き直してください。", "Waiting for payment confirmation. Your files are safe. Please reopen this screen later."));
  }, [ja, onPurchased]);

  const pay = useCallback(async () => {
    if (!order) return;
    const provider = walletProvider();
    if (!provider) {
      setMessage(t(ja, "支払いにはウォレットが必要です。ウォレットを接続してください。", "A wallet is required. Please connect your wallet."));
      return;
    }
    setPhase("paying");
    setMessage("");
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const buyer = accounts?.[0];
      if (typeof buyer !== "string") throw new Error("no_account");
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${order.chainId.toString(16)}` }] });
      // 確認画面はハブのウォレットのもの。ここは送金の中身（トークンの契約・受け取り先・数量）を渡すだけ。
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: buyer, to: order.tokenAddress, data: erc20TransferData(order.payTo, order.amountAtomic), value: "0x0" }],
      });
      if (typeof hash !== "string") throw new Error("not_submitted");
      setPhase("waiting");
      const r = await fetch(`${COMMERCE_STORAGE_PLANS_BASE}/orders/${order.orderId}/payment`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ orderToken: order.orderToken, transactionHash: hash, buyerAddress: buyer }),
      });
      if (r.status === 422 || r.status === 409) {
        setMessage(t(ja, "送金を確認できませんでした。内容が注文と合っていません。", "The transfer could not be verified against this order."));
        setPhase("failed");
        return;
      }
      // 200 / 202 のどちらでも、確認は Commerce の状態を読み直して決める。
      await poll(order);
    } catch {
      setMessage(t(ja, "送金は完了しませんでした。ウォレットで取り消した可能性があります。", "The transfer was not completed. You may have cancelled it in your wallet."));
      setPhase("confirm");
    }
  }, [ja, order, poll]);

  const receiptHref = order ? `${COMMERCE_STORAGE_PLANS_BASE}/orders/${order.orderId}/receipt?t=${order.orderToken}` : null;

  return (
    <section className="storage-plan" aria-labelledby="storage-plan-title" data-phase={phase}>
      <header>
        <h3 id="storage-plan-title">{t(ja, "保存容量プラン", "Storage plans")}</h3>
        <button type="button" onClick={onClose}>{t(ja, "閉じる", "Close")}</button>
      </header>

      {phase === "plans" || phase === "creating" ? (
        <>
          {listingError ? (
            <p role="alert" className="storage-plan__error">{t(ja, "プランを読み込めません。", "Plans could not be loaded.")}</p>
          ) : !listing ? (
            <p role="status">{t(ja, "プランを読み込んでいます…", "Loading plans…")}</p>
          ) : !listing.available ? (
            <p role="status" className="storage-plan__note">{t(ja, "プランの販売は現在準備中です。無料の容量はそのまま使えます。", "Plans are not on sale yet. Your free capacity keeps working.")}</p>
          ) : (
            <>
              <ul className="storage-plan__cards" aria-label={t(ja, "プランの一覧", "Plans")}>
                {listing.plans.map((p) => (
                  <li key={p.code}>
                    <button type="button" aria-pressed={planCode === p.code} data-selected={planCode === p.code} onClick={() => setPlanCode(p.code)}>
                      <strong>{t(ja, `プラン ${p.code}`, `Plan ${p.code}`)}</strong>
                      <span>{planBytesLabel(p.bytes)}</span>
                      <b>{t(ja, `${p.priceJpy.toLocaleString("ja-JP")}円 / ${p.termDays}日`, `¥${p.priceJpy.toLocaleString("en")} / ${p.termDays} days`)}</b>
                    </button>
                  </li>
                ))}
              </ul>
              <fieldset className="storage-plan__tokens">
                <legend>{t(ja, "支払いに使うトークン", "Payment token")}</legend>
                <label><input type="radio" name="storage-token" checked={token === "JPYC"} onChange={() => setToken("JPYC")} /> JPYC</label>
                <label>
                  <input type="radio" name="storage-token" checked={token === "USDC"} disabled={!usdcOpen} onChange={() => setToken("USDC")} /> USDC
                  {!usdcOpen ? <small>{t(ja, "今は USDC で払えません。JPYC なら払えます。", "USDC is unavailable now. JPYC is available.")}</small> : null}
                </label>
                {listing.chainName ? <small>{t(ja, `ネットワーク: ${listing.chainName}`, `Network: ${listing.chainName}`)}</small> : null}
              </fieldset>
              <label className="storage-plan__age">
                <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
                {t(ja, "18歳以上です", "I am 18 or older")}
              </label>
              <button type="button" className="storage-plan__primary" disabled={!plan || !age || phase === "creating"} onClick={() => void createOrder()}>
                {phase === "creating" ? t(ja, "準備しています…", "Preparing…") : t(ja, "確認へ進む", "Continue to confirmation")}
              </button>
            </>
          )}
        </>
      ) : null}

      {order && (phase === "confirm" || phase === "paying" || phase === "waiting" || phase === "failed") ? (
        <div className="storage-plan__confirm" aria-label={t(ja, "最終確認", "Final confirmation")}>
          <h4>{t(ja, "最終確認", "Final confirmation")}</h4>
          <p className="storage-plan__what">{order.description}</p>
          <dl>
            <div><dt>{t(ja, "価格", "Price")}</dt><dd>{t(ja, `${order.priceJpy.toLocaleString("ja-JP")}円`, `¥${order.priceJpy.toLocaleString("en")}`)}</dd></div>
            <div><dt>{t(ja, "支払い", "Pay")}</dt><dd>{order.displayAmount} {order.token}</dd></div>
            <div><dt>{t(ja, "期間", "Term")}</dt><dd>{t(ja, `${order.termDays}日（前払い）`, `${order.termDays} days (prepaid)`)}</dd></div>
            <div><dt>{t(ja, "更新", "Renewal")}</dt><dd>{t(ja, "手動更新です。自動では引き落とされません。", "Manual renewal. Nothing is charged automatically.")}</dd></div>
            {order.fx ? (
              <div><dt>{t(ja, "換算レート", "Rate")}</dt><dd>{t(ja, `1ドル = ${Number(order.fx.jpyPerUnitMicros) / 1e6}円（${order.fx.rateDate}、${order.fx.source}）`, `1 USD = ${Number(order.fx.jpyPerUnitMicros) / 1e6} JPY (${order.fx.rateDate}, ${order.fx.source})`)}</dd></div>
            ) : null}
            <div><dt>{t(ja, "返金", "Refunds")}</dt><dd>{t(ja, "始まっていない更新分だけ返金できます。", "Only a renewal that has not started can be refunded.")}</dd></div>
            <div><dt>{t(ja, "注文の期限", "Order expires")}</dt><dd>{new Date(order.expiresAt).toLocaleTimeString(ja ? "ja-JP" : "en")}</dd></div>
          </dl>
          <p><a href={COMMERCE_LEGAL_PATH} target="_blank" rel="noreferrer">{t(ja, "特定商取引法に基づく表示", "Legal notice (Specified Commercial Transactions Act)")}</a></p>
          <p className="storage-plan__note">{t(ja, "ネットワーク手数料（ガス代）が別にかかる場合があります。", "A network fee (gas) may apply separately.")}</p>
          <button type="button" className="storage-plan__primary" disabled={phase !== "confirm"} onClick={() => void pay()}>
            {phase === "paying" ? t(ja, "ウォレットで確認中…", "Confirming in wallet…") : phase === "waiting" ? t(ja, "確認しています…", "Verifying…") : t(ja, "ウォレットで支払う", "Pay with wallet")}
          </button>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="storage-plan__done" role="status">
          <strong>{t(ja, "容量が追加されました", "Capacity added")}</strong>
          {receiptHref ? <a href={receiptHref} target="_blank" rel="noreferrer">{t(ja, "領収を見る", "View receipt")}</a> : null}
        </div>
      ) : null}

      {message ? <p role="status" className="storage-plan__message">{message}</p> : null}
    </section>
  );
}
