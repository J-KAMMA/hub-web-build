"use client";

// 保存容量プランの自動更新（docs/hub-storage-plans/AUTOPAY.md §2・§4・§6）。
// ブラウザが Commerce を直接呼ぶ。Hub は申込み・取り消し・取引ID・主張を中継しない。
// ウォレットは Commerce の引き落とし用コントラクトへの上限つき approve（3 回分まで）と subscribe に署名する。
// Hub が受け取るのは Account 経由の「方式」と「次の更新時刻」だけ。Fuji（テストネット）だけで動く。
// 表示は「保存容量プランの自動更新」だけ。交換・価格比較・経路の言葉は出さない。

import React, { useCallback, useEffect, useRef, useState } from "react";

import "./storage-plans.css";
import {
  ACCOUNT_STORAGE_PURCHASE_ASSERTION,
  COMMERCE_LEGAL_PATH,
  COMMERCE_STORAGE_AUTOPAY_BASE,
  COMMERCE_STORAGE_PLANS_BASE,
  STORAGE_AUTOPAY_ALLOWED_CHAIN_IDS,
  autopaySubscribeData,
  erc20ApproveData,
  parseAutopayOffer,
  parsePlanListing,
  planBytesLabel,
  type AutopayOffer,
  type StoragePlanListing,
} from "@/lib/storage-plans";

type Token = "JPYC" | "USDC";
type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
type Phase = "form" | "creating" | "confirm" | "approving" | "subscribing" | "verifying" | "done" | "failed";

const POLL_MS = 4000;
const POLL_LIMIT = 45;
const t = (ja: boolean, jaText: string, enText: string) => (ja ? jaText : enText);

function walletProvider(): Provider | null {
  const host = window as Window & { hubNativeWallet?: Provider; ethereum?: Provider };
  return host.hubNativeWallet ?? host.ethereum ?? null;
}

/** 利用者がこのセッションで止めたしるし。Hub の「止まりました」通知を出さないために、容量の読み出しに添える。 */
export const AUTOPAY_STOPPED_KEY = "hub.storageAutopay.userStopped";

type RevokeInfo = { contractAddress: string; tokenAddress: string };
const isAddr = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/u.test(v);

/** 許可を取り消すための相手とトークン。Commerce の status をブラウザが直接読む（Hub のサーバーは通さない）。 */
async function readRevokeInfo(): Promise<RevokeInfo | null> {
  try {
    const assertion = await paymentAssertion();
    const r = await fetch(`${COMMERCE_STORAGE_AUTOPAY_BASE}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ assertion }),
    });
    const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    return r.ok && isAddr(body?.contractAddress) && isAddr(body?.tokenAddress) ? { contractAddress: body.contractAddress, tokenAddress: body.tokenAddress } : null;
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 次の更新時刻の表示（日本時間）。読めなければ null。 */
export function renewalDateLabel(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(time);
}

async function paymentAssertion(): Promise<string> {
  const a = await fetch(ACCOUNT_STORAGE_PURCHASE_ASSERTION, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
  if (!a.ok) throw new Error(a.status === 403 ? "reauth" : "assertion");
  const { assertion } = (await a.json()) as { assertion?: string };
  if (typeof assertion !== "string") throw new Error("assertion");
  return assertion;
}

/** 続いている間の欄：方式・次の更新時刻・止めるボタン。止めるのは 1 回の操作で、理由も引き止めも出さない（§4.2）。 */
export function StorageAutopayStatus({ locale, nextRenewalAt, onChanged }: { locale: string; nextRenewalAt: string | null; onChanged: () => void }) {
  const ja = locale === "ja";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [stopped, setStopped] = useState(false);
  const [revoke, setRevoke] = useState<RevokeInfo | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const next = renewalDateLabel(nextRenewalAt, locale);

  const stop = useCallback(async () => {
    setBusy(true);
    setMessage("");
    try {
      // 止めたあとは Commerce から相手が読めなくなるので、先に控える（許可の取り消しに使う）。
      const info = await readRevokeInfo();
      if (info) setRevoke(info);
      const assertion = await paymentAssertion();
      const r = await fetch(`${COMMERCE_STORAGE_AUTOPAY_BASE}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ assertion }),
      });
      if (!r.ok) throw new Error("cancel");
      setStopped(true);
      try { window.sessionStorage.setItem(AUTOPAY_STOPPED_KEY, "1"); } catch { /* 無くても動く */ }
      setMessage(t(ja, "自動更新を止めました。次の引き落としはありません。今の期間は期限まで使えます。", "Automatic renewal is stopped. There will be no further charge. Your current period stays active until it ends."));
      onChanged();
    } catch (error) {
      setMessage(
        (error as Error).message === "reauth"
          ? t(ja, "止めるには、もう一度ログインして本人確認をしてください。", "Please sign in again to confirm it is you.")
          : t(ja, "止める操作を送れませんでした。もう一度お試しください。", "The request could not be sent. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }, [ja, onChanged]);

  const openRevoke = useCallback(async () => {
    setMessage("");
    const info = revoke ?? (await readRevokeInfo());
    if (!info) {
      setMessage(t(ja, "許可の相手を読めませんでした。ウォレットの設定からも取り消せます。", "Could not read the allowance target. You can also revoke it from your wallet settings."));
      return;
    }
    setRevoke(info);
    setRevokeOpen(true);
  }, [ja, revoke]);

  const signRevoke = useCallback(async () => {
    if (!revoke) return;
    const provider = walletProvider();
    if (!provider) {
      setMessage(t(ja, "ウォレットが必要です。ウォレットを接続してください。", "A wallet is required. Please connect your wallet."));
      return;
    }
    setBusy(true);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (typeof accounts?.[0] !== "string") throw new Error("no_account");
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${STORAGE_AUTOPAY_ALLOWED_CHAIN_IDS[0].toString(16)}` }] });
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: accounts[0], to: revoke.tokenAddress, data: erc20ApproveData(revoke.contractAddress, "0"), value: "0x0" }],
      });
      if (typeof hash !== "string") throw new Error("not_submitted");
      setRevoked(true);
      setRevokeOpen(false);
      setMessage(t(ja, "許可を 0 に戻す取引を送りました。", "The transaction to reset the allowance to 0 was sent."));
    } catch {
      setMessage(t(ja, "許可は取り消されませんでした。ウォレットで取り消した可能性があります。", "The allowance was not revoked. You may have cancelled it in your wallet."));
    } finally {
      setBusy(false);
    }
  }, [ja, revoke]);

  return (
    <div className="storage-autopay__status" data-mode={stopped ? "manual" : "auto"}>
      <p>
        <strong>{t(ja, "自動更新: 有効", "Automatic renewal: on")}</strong>
        {next ? <span>{t(ja, ` ・ 次の更新 ${next}`, ` · next renewal ${next}`)}</span> : null}
      </p>
      {!stopped ? (
        <button type="button" disabled={busy} onClick={() => void stop()}>
          {t(ja, "自動更新を止める", "Stop automatic renewal")}
        </button>
      ) : null}
      {!revoked && !revokeOpen ? (
        <button type="button" disabled={busy} onClick={() => void openRevoke()}>
          {t(ja, "許可を取り消す", "Revoke allowance")}
        </button>
      ) : null}
      {revokeOpen && revoke ? (
        <div className="storage-autopay__revoke" aria-label={t(ja, "許可の取り消し", "Revoke allowance")}>
          <p>{t(ja, "ウォレットの許可を 0 に戻します。以後、このコントラクトは引き落とせません。", "This resets your wallet allowance to 0. The contract can no longer charge you.")}</p>
          <dl>
            <div><dt>{t(ja, "相手のコントラクト", "Contract")}</dt><dd>{revoke.contractAddress}</dd></div>
            <div><dt>{t(ja, "トークン", "Token")}</dt><dd>{revoke.tokenAddress}</dd></div>
            <div><dt>{t(ja, "許可の額", "Allowance")}</dt><dd>0</dd></div>
          </dl>
          <button type="button" disabled={busy} onClick={() => void signRevoke()}>{t(ja, "ウォレットで署名する", "Sign in wallet")}</button>
          <button type="button" disabled={busy} onClick={() => setRevokeOpen(false)}>{t(ja, "やめる", "Back")}</button>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

export function StorageAutopay({ locale, onClose, onStarted }: { locale: string; onClose: () => void; onStarted?: () => void }) {
  const ja = locale === "ja";
  const [listing, setListing] = useState<StoragePlanListing | null>(null);
  const [listingError, setListingError] = useState(false);
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [token, setToken] = useState<Token>("JPYC");
  const [age, setAge] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [offer, setOffer] = useState<AutopayOffer | null>(null);
  const [message, setMessage] = useState("");
  const [nextRenewalAt, setNextRenewalAt] = useState<string | null>(null);
  const gone = useRef(false);

  useEffect(() => {
    gone.current = false;
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
      gone.current = true;
    };
  }, []);

  const plan = listing?.plans.find((p) => p.code === planCode) ?? null;
  const usdcOpen = listing?.tokens?.USDC.available === true;
  const testnetOnly = !listing?.chainId || STORAGE_AUTOPAY_ALLOWED_CHAIN_IDS.includes(listing.chainId);

  const create = useCallback(async () => {
    if (!plan || !age) return;
    setPhase("creating");
    setMessage("");
    try {
      const assertion = await paymentAssertion();
      const r = await fetch(`${COMMERCE_STORAGE_AUTOPAY_BASE}/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ assertion, planCode: plan.code, token, ageDeclared18: true }),
      });
      const body = (await r.json().catch(() => null)) as (Record<string, unknown> & { error?: string }) | null;
      const parsed = r.ok ? parseAutopayOffer(body) : null;
      if (!parsed) {
        const error = body?.error;
        setMessage(
          error === "autopay_already_active"
            ? t(ja, "すでに自動更新が続いています。", "Automatic renewal is already on.")
            : error === "usdc_rate_unavailable"
              ? t(ja, "今は USDC で申し込めません。JPYC なら申し込めます。", "USDC is unavailable right now. You can use JPYC.")
              : error === "autopay_capacity_reached"
                ? t(ja, "自動更新は今、受け付けを上限まで使っています。手動の更新はできます。", "Automatic renewal is full for now. Manual renewal still works.")
                : r.ok
                  ? t(ja, "このネットワークでは自動更新を開けません。", "Automatic renewal is not available on this network.")
                  : t(ja, "申込みを作れませんでした。時間をおいて、もう一度お試しください。", "The request could not be created. Please try again later."),
        );
        if (error === "usdc_rate_unavailable") setToken("JPYC");
        setPhase("form");
        return;
      }
      setOffer(parsed);
      setPhase("confirm");
    } catch (error) {
      setMessage(
        (error as Error).message === "reauth"
          ? t(ja, "申し込むには、もう一度ログインして本人確認をしてください。", "Please sign in again to confirm it is you.")
          : t(ja, "申込みの準備ができませんでした。Account に接続できているか確認してください。", "Could not prepare. Check that your account is connected."),
      );
      setPhase("form");
    }
  }, [age, ja, plan, token]);

  const verify = useCallback(
    async (o: AutopayOffer, hash: string, payer: string) => {
      setPhase("verifying");
      for (let i = 0; i < POLL_LIMIT; i += 1) {
        if (gone.current) return;
        try {
          const r = await fetch(`${COMMERCE_STORAGE_AUTOPAY_BASE}/subscriptions/${o.subscriptionId}/confirm`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ subscriptionToken: o.subscriptionToken, transactionHash: hash, payerAddress: payer }),
          });
          const body = (await r.json().catch(() => null)) as { status?: string; nextRenewalAt?: number | string } | null;
          if (r.status === 422 || r.status === 409) {
            setMessage(t(ja, "取引を確認できませんでした。内容が申込みと合っていません。", "The transaction could not be verified against this request."));
            setPhase("failed");
            return;
          }
          if (r.ok && body?.status === "active") {
            const due = body.nextRenewalAt;
            setNextRenewalAt(typeof due === "number" ? new Date(due * 1000).toISOString() : typeof due === "string" ? due : null);
            setPhase("done");
            onStarted?.();
            return;
          }
        } catch {
          /* 次の周で読み直す */
        }
        await wait(POLL_MS);
      }
      setMessage(t(ja, "確認を待っています。ファイルは安全です。あとでこの画面を開き直してください。", "Waiting for confirmation. Your files are safe. Please reopen this screen later."));
    },
    [ja, onStarted],
  );

  const sign = useCallback(async () => {
    if (!offer) return;
    if (!STORAGE_AUTOPAY_ALLOWED_CHAIN_IDS.includes(offer.chainId)) {
      setMessage(t(ja, "自動更新はテストネットだけで使えます。", "Automatic renewal works on the test network only."));
      return;
    }
    const provider = walletProvider();
    if (!provider) {
      setMessage(t(ja, "ウォレットが必要です。ウォレットを接続してください。", "A wallet is required. Please connect your wallet."));
      return;
    }
    setMessage("");
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const payer = accounts?.[0];
      if (typeof payer !== "string") throw new Error("no_account");
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${offer.chainId.toString(16)}` }] });
      // 1. 上限つきの許可（3 回分まで）。相手は Commerce の引き落とし用コントラクトだけ。
      setPhase("approving");
      const approveHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: payer, to: offer.tokenAddress, data: erc20ApproveData(offer.contractAddress, offer.approveAtomic), value: "0x0" }],
      });
      if (typeof approveHash !== "string") throw new Error("not_submitted");
      // 許可が確定してから申し込む（確定前の subscribe は失敗する）。
      let approved = false;
      for (let i = 0; i < POLL_LIMIT && !approved; i += 1) {
        const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [approveHash] })) as { status?: string } | null;
        if (receipt) {
          if (receipt.status !== "0x1") throw new Error("approve_failed");
          approved = true;
        } else await wait(POLL_MS);
      }
      if (!approved) throw new Error("approve_pending");
      // 2. 申込み。最初の 1 回をその場で引き落とす。
      setPhase("subscribing");
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: payer, to: offer.contractAddress, data: autopaySubscribeData({ planCodeHash: offer.planCodeHash, tokenAddress: offer.tokenAddress, amountAtomic: offer.amountAtomic, ref: offer.ref }), value: "0x0" }],
      });
      if (typeof hash !== "string") throw new Error("not_submitted");
      await verify(offer, hash, payer);
    } catch {
      setMessage(t(ja, "手続きは完了しませんでした。ウォレットで取り消した可能性があります。許可だけが残っている場合は、ウォレットで取り消せます。", "The process was not completed. You may have cancelled it in your wallet. If only the allowance remains, you can revoke it in your wallet."));
      setPhase("confirm");
    }
  }, [ja, offer, verify]);

  const busy = phase === "approving" || phase === "subscribing" || phase === "verifying";
  const price = plan ? plan.priceJpy.toLocaleString(ja ? "ja-JP" : "en") : "";
  const cap = plan ? (plan.priceJpy * 3).toLocaleString(ja ? "ja-JP" : "en") : "";

  return (
    <section className="storage-plan storage-autopay" aria-labelledby="storage-autopay-title" data-phase={phase}>
      <header>
        <h3 id="storage-autopay-title">{t(ja, "自動で更新する", "Renew automatically")}</h3>
        <button type="button" onClick={onClose}>{t(ja, "閉じる", "Close")}</button>
      </header>

      {phase === "form" || phase === "creating" ? (
        <>
          {listingError ? (
            <p role="alert" className="storage-plan__error">{t(ja, "プランを読み込めません。", "Plans could not be loaded.")}</p>
          ) : !listing ? (
            <p role="status">{t(ja, "プランを読み込んでいます…", "Loading plans…")}</p>
          ) : !listing.available || !testnetOnly ? (
            <p role="status" className="storage-plan__note">{t(ja, "自動更新は今は使えません。手動の更新はできます。", "Automatic renewal is not available now. Manual renewal still works.")}</p>
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
                <legend>{t(ja, "引き落とすトークン", "Token")}</legend>
                <label><input type="radio" name="autopay-token" checked={token === "JPYC"} onChange={() => setToken("JPYC")} /> JPYC</label>
                <label>
                  <input type="radio" name="autopay-token" checked={token === "USDC"} disabled={!usdcOpen} onChange={() => setToken("USDC")} /> USDC
                  {!usdcOpen ? <small>{t(ja, "今は USDC で申し込めません。", "USDC is unavailable now.")}</small> : null}
                </label>
                <small>{t(ja, "テストネット（Fuji）だけで動きます。", "Runs on the Fuji test network only.")}</small>
              </fieldset>
              <ul className="storage-autopay__explain">
                <li>{plan ? t(ja, `ウォレットから、30 日に 1 回、${price}円分だけを引き落とす許可を出します。`, `You allow one charge of ¥${price} at most every 30 days.`) : t(ja, "ウォレットから、30 日に 1 回、プランの価格分だけを引き落とす許可を出します。", "You allow one charge of the plan price at most every 30 days.")}</li>
                <li>{t(ja, "お金を預けるのではありません。お金はウォレットに残ります。", "You are not depositing money. Your funds stay in your wallet.")}</li>
                <li>{plan ? t(ja, `許可の上限は ${cap}円分（3 回分、約 3 か月）です。使い切ったら、もう一度許可を出すまで止まります。`, `The allowance cap is ¥${cap} (3 payments, about 3 months). It stops when used up until you allow again.`) : t(ja, "許可の上限は 3 回分（約 3 か月）です。", "The allowance cap is 3 payments (about 3 months).")}</li>
                <li>{t(ja, "引き落としの 3 日前に Hub の通知でお知らせします。いつでも止められます。", "We notify you in Hub 3 days before each charge. You can stop at any time.")}</li>
              </ul>
              <label className="storage-plan__age">
                <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
                {t(ja, "18歳以上です", "I am 18 or older")}
              </label>
              <button type="button" className="storage-plan__primary" disabled={!plan || !age || phase === "creating"} onClick={() => void create()}>
                {phase === "creating" ? t(ja, "準備しています…", "Preparing…") : t(ja, "最終確認へ進む", "Continue to final confirmation")}
              </button>
            </>
          )}
        </>
      ) : null}

      {offer && plan && (phase === "confirm" || busy || phase === "failed") ? (
        <div className="storage-plan__confirm" aria-label={t(ja, "最終確認", "Final confirmation")}>
          <h4>{t(ja, "最終確認", "Final confirmation")}</h4>
          <p className="storage-plan__what">{t(ja, `保存容量 ${planBytesLabel(plan.bytes)} を 30 日ずつ。取り消すまで自動で続きます。`, `${planBytesLabel(plan.bytes)} of storage, 30 days at a time. Continues until you stop it.`)}</p>
          <dl>
            <div><dt>{t(ja, "対価", "Price")}</dt><dd>{t(ja, `30 日ごとに ${offer.displayAmount} ${offer.token}（${price}円）`, `${offer.displayAmount} ${offer.token} (¥${price}) every 30 days`)}</dd></div>
            <div><dt>{t(ja, "総額", "Total")}</dt><dd>{t(ja, `取り消すまで、30 日ごとに上の額がかかります。例：3 回続けると ${cap}円分。`, `The amount above is charged every 30 days until you stop. Example: 3 times is ¥${cap}.`)}</dd></div>
            <div><dt>{t(ja, "支払いの時期", "Timing")}</dt><dd>{t(ja, "今日 1 回目。その後は 30 日ごと。引き落としの 3 日前に知らせます。", "First charge today, then every 30 days. We notify you 3 days before each charge.")}</dd></div>
            <div>
              <dt>{t(ja, "支払いの方法", "Method")}</dt>
              <dd>
                {t(ja, `あなたのウォレットから、Commerce の引き落とし用コントラクト（${offer.contractAddress}）へ、最大 ${Math.round(Number(offer.displayAmount) * offer.maxPulls * 100) / 100} ${offer.token}（${offer.maxPulls} 回分）の引き出しを許可します。1 回に引き落とすのは ${offer.displayAmount} ${offer.token} だけで、30 日に 1 回までです。`, `You allow the Commerce autopay contract (${offer.contractAddress}) to pull up to ${offer.maxPulls} payments from your wallet. Each charge is ${offer.displayAmount} ${offer.token}, at most once every 30 days.`)}
              </dd>
            </div>
            <div><dt>{t(ja, "提供の時期", "Delivery")}</dt><dd>{t(ja, "支払いの確認の後すぐ。2 回目からは今の期限の翌日から。", "Right after payment is confirmed. From the second charge, from the day after the current term ends.")}</dd></div>
            <div><dt>{t(ja, "申込みの期間", "Offer period")}</dt><dd>{t(ja, "なし", "None")}</dd></div>
            <div><dt>{t(ja, "解除", "Stopping")}</dt><dd>{t(ja, "いつでも 1 回の操作で止められます。止めた後の引き落としはありません。今の 30 日分は期限まで使え、返金はしません。違約金はありません。", "Stop anytime in one step. No charge after that. The current 30 days stay active; no refund. No penalty.")}</dd></div>
            <div><dt>{t(ja, "残高が足りないとき", "Low balance")}</dt><dd>{t(ja, "引き落としを止め、7 日の猶予の後、無料の 100MB に戻ります。ファイルは消えません。", "The charge stops; after a 7-day grace period the plan returns to the free 100MB. Files are not deleted.")}</dd></div>
          </dl>
          <p><a href={COMMERCE_LEGAL_PATH} target="_blank" rel="noreferrer">{t(ja, "特定商取引法に基づく表示", "Legal notice (Specified Commercial Transactions Act)")}</a></p>
          <p className="storage-plan__note">{t(ja, "許可と申込みの 2 回、ウォレットで署名します。ネットワーク手数料（ガス代）が別にかかる場合があります。", "You sign twice in your wallet: the allowance and the subscription. A network fee (gas) may apply.")}</p>
          <button type="button" className="storage-plan__primary" disabled={phase !== "confirm"} onClick={() => void sign()}>
            {phase === "approving" ? t(ja, "許可を確認中…", "Confirming allowance…") : phase === "subscribing" ? t(ja, "ウォレットで確認中…", "Confirming in wallet…") : phase === "verifying" ? t(ja, "確認しています…", "Verifying…") : t(ja, "ウォレットで署名して始める", "Sign in wallet to start")}
          </button>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="storage-plan__done" role="status">
          <strong>{t(ja, "自動更新を始めました", "Automatic renewal started")}</strong>
          {renewalDateLabel(nextRenewalAt, locale) ? <span>{t(ja, `次の更新: ${renewalDateLabel(nextRenewalAt, locale)}`, `Next renewal: ${renewalDateLabel(nextRenewalAt, locale)}`)}</span> : null}
        </div>
      ) : null}

      {message ? <p role="status" className="storage-plan__message">{message}</p> : null}
    </section>
  );
}
