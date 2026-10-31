"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  FederatedListing,
  FederatedSignedQuote,
} from "@/lib/platform/federated-commerce";
import styles from "./federated-product-checkout.module.css";

type ListingResponse = { listing?: FederatedListing; error?: string };
type QuoteResponse = { quote?: FederatedSignedQuote; error?: string };

function host(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function compactAddress(value?: string) {
  if (!value) return "—";
  return value.length > 18
    ? `${value.slice(0, 10)}…${value.slice(-6)}`
    : value;
}

function listingError(code: string) {
  switch (code) {
    case "authentication_required":
      return "購入条件を確認するにはHubへログインしてください。";
    case "federation_public_origin_required":
      return "公開HTTPS環境で購入条件を取得できます。ローカル環境では商品情報だけ確認できます。";
    case "quote_fee_mismatch":
    case "quote_route_mismatch":
      return "販売者がHubマーケットの取引条件に同意していないため、購入できません。";
    default:
      return "署名付きの購入条件を取得できませんでした。時間をおいて、もう一度お試しください。";
  }
}

export function FederatedProductCheckout({ listingUrl }: { listingUrl: string }) {
  const [listing, setListing] = useState<FederatedListing | null>(null);
  const [quote, setQuote] = useState<FederatedSignedQuote | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setListing(null);
    setQuote(null);
    setError("");
    if (!listingUrl) {
      setError("商品URLが指定されていません。");
      return () => controller.abort();
    }
    void fetch(
      `/api/federation/commerce/listings?q=${encodeURIComponent(listingUrl)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => ({
        ok: response.ok,
        body: (await response.json()) as ListingResponse,
      }))
      .then(({ ok, body }) => {
        if (!ok || !body.listing) {
          throw new Error(body.error ?? "listing_unavailable");
        }
        setListing(body.listing);
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name !== "AbortError") {
          setError("販売者ノードの商品情報を確認できませんでした。");
        }
      });
    return () => controller.abort();
  }, [listingUrl]);

  const inventory = listing?.approximateInventory;
  const quantityMax = useMemo(
    () => Math.max(1, Math.min(100, inventory ?? 100)),
    [inventory],
  );

  async function requestQuote() {
    if (!listing || busy) return;
    setBusy(true);
    setError("");
    setQuote(null);
    try {
      const response = await fetch("/api/federation/commerce/quotes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingUrl: listing.listingId,
          quantity,
          route: "hub-referral",
        }),
      });
      const body = (await response.json()) as QuoteResponse;
      if (!response.ok || !body.quote) {
        throw new Error(body.error ?? "quote_unavailable");
      }
      setQuote(body.quote);
    } catch (cause) {
      setError(listingError(cause instanceof Error ? cause.message : ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <a className={styles.back} href="/v2/market">
        ← マーケットへ戻る
      </a>

      {error && !listing ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {listing ? (
        <>
          <article className={styles.product}>
            <header className={styles.productHeader}>
              <span className={styles.eyebrow}>連合商品</span>
              <h1>{listing.title}</h1>
              <p>{listing.description}</p>
              <strong className={styles.price}>
                {listing.price} {listing.currency}
              </strong>
              <span className={styles.verified}>販売者ノードを検証済み</span>
            </header>

            <dl className={styles.facts}>
              <div>
                <dt>販売者</dt>
                <dd>{host(listing.sellerActor)}</dd>
              </div>
              <div>
                <dt>販売者ID</dt>
                <dd>{listing.sellerActor}</dd>
              </div>
              <div>
                <dt>発送地域</dt>
                <dd>{listing.shippingRegions.join("・") || "購入前に確認"}</dd>
              </div>
              <div>
                <dt>在庫</dt>
                <dd>{inventory === undefined ? "購入前に確認" : `約${inventory}点`}</dd>
              </div>
              <div>
                <dt>購入方法</dt>
                <dd>Hub内の署名付き見積もり・決済</dd>
              </div>
            </dl>

            <div className={styles.controls}>
              <label>
                数量
                <input
                  type="number"
                  min={1}
                  max={quantityMax}
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(
                      Math.max(
                        1,
                        Math.min(quantityMax, Number(event.target.value) || 1),
                      ),
                    );
                    setQuote(null);
                  }}
                />
              </label>
              <button
                className={styles.primary}
                type="button"
                disabled={busy}
                onClick={() => void requestQuote()}
              >
                {busy ? "確認中…" : "購入条件を確認"}
              </button>
              <a
                className={styles.secondary}
                href={`/v2/messages?compose=${encodeURIComponent(listing.sellerActor)}`}
              >
                販売者に質問
              </a>
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </article>

          {quote ? (
            <section className={styles.quote} aria-labelledby="quote-title">
              <div className={styles.section}>
                <h2 id="quote-title">購入前の最終確認</h2>
                <p>
                  販売者ノードの署名、商品版、数量、有効期限を確認しました。
                  期限後は新しい見積もりが必要です。
                </p>
              </div>
              <dl className={styles.breakdown}>
                <div>
                  <dt>支払い上限</dt>
                  <dd>{quote.totalAmount} {quote.currency}</dd>
                </div>
                <div>
                  <dt>数量</dt>
                  <dd>{quote.quantity}</dd>
                </div>
                <div>
                  <dt>Hubマーケット手数料</dt>
                  <dd>販売者負担・本体価格の1%（消費税込み）</dd>
                </div>
                <div>
                  <dt>手数料の発生</dt>
                  <dd>売上確定時のみ</dd>
                </div>
                <div>
                  <dt>エスクロー</dt>
                  <dd>{quote.escrowContract ? compactAddress(quote.escrowContract) : "この商品には含まれません"}</dd>
                </div>
                <div>
                  <dt>見積期限</dt>
                  <dd>{new Date(quote.reservedUntil).toLocaleString("ja-JP")}</dd>
                </div>
              </dl>
              <p className={styles.notice}>
                決済と注文記録はCommerceが管理します。Hubは秘密鍵、決済認可、注文台帳を保持しません。
              </p>
              <div className={styles.controls}>
                <button
                  className={styles.primary}
                  type="button"
                  disabled
                  title="連合商品のCommerce注文APIを接続後に利用できます"
                >
                  Hubで購入
                </button>
                <button
                  className={styles.secondary}
                  type="button"
                  onClick={() => setQuote(null)}
                >
                  条件を変更
                </button>
              </div>
              <p className={styles.notice} role="status">
                現在は署名付き条件の確認まで利用できます。資金移動を伴う連合注文は、Commerce側の独立検証が完了するまで実行しません。
              </p>
            </section>
          ) : null}
        </>
      ) : !error ? (
        <p className={styles.notice}>商品情報を確認しています…</p>
      ) : null}
    </div>
  );
}
