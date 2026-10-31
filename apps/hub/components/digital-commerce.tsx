"use client";

import { useEffect, useState } from "react";
import { commerceApiUrl, commerceRequest } from "@/lib/commerce-client";
import type { ProductTaxIncluded } from "@/lib/commerce-product";
import { useHubSurfaceNavigation } from "@/lib/use-hub-surface-navigation";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { SkeletonList } from "@/components/v2/ui/skeleton";

type Product = {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  priceJpyc: number;
  fulfillmentType: string;
  taxIncluded?: ProductTaxIncluded;
  seller: { publicName: string; legalDisplayUrl: string };
};

type Asset = {
  currency: string;
  chainId: number;
};

type PaymentRequestResponse = {
  paymentRequest?: { token?: string };
  error?: string;
};

async function commerce(path: string, init?: RequestInit) {
  return commerceRequest<Record<string, unknown>>(path, init);
}

export function DigitalCommerce() {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const navigateHubRoute = useHubSurfaceNavigation();
  const [products, setProducts] = useState<Product[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [country, setCountry] = useState("JP");
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [message, setMessage] = useState("商品を読み込んでいます。");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedProduct = params.get("q")?.trim().toLocaleLowerCase() ?? "";
    /* ゲームの店の「購入」は ?product=<Commerce の商品ID> で、その1品だけを出す（2026-10-18）。 */
    const requestedProductId = params.get("product")?.trim().toLowerCase() ?? "";
    Promise.all([
      /^[0-9a-f-]{36}$/.test(requestedProductId)
        ? commerce(`/products/${encodeURIComponent(requestedProductId)}`).then((body) => ({ products: body.product ? [body.product] : [] }))
        : commerce("/products?kind=digital"),
      commerce("/payment/assets"),
    ])
      .then(([productBody, assetBody]) => {
        const available = Array.isArray(productBody.products)
          ? (productBody.products as Product[]).filter(
              (product) =>
                product.fulfillmentType === "digital" &&
                (!requestedProductId || product.id === requestedProductId) &&
                (!requestedProduct ||
                  `${product.title} ${product.description}`
                    .toLocaleLowerCase()
                    .includes(requestedProduct)),
            )
          : [];
        const paymentAssets = Array.isArray(assetBody.assets)
          ? (assetBody.assets as Asset[]).filter((asset) =>
              ["JPYC", "USDC"].includes(asset.currency),
            )
          : [];
        setProducts(available);
        setAssets(paymentAssets);
        setMessage(
          available.length
            ? "商品と請求先国を確認してください。"
            : requestedProduct
              ? "指定された容量商品は現在販売されていません。決済や注文は作成されていません。"
              : "現在購入できるデジタル商品はありません。",
        );
      })
      .catch(() => setMessage("Commerceサービスへ接続できません。"))
      .finally(() => setLoading(false));
  }, []);

  async function purchase(product: Product) {
    const billingCountry = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(billingCountry)) {
      setMessage("請求先国を2文字の国コードで入力してください。");
      return;
    }
    const asset = assets[0];
    if (!asset) {
      setMessage("現在利用できる支払い方法がありません。");
      return;
    }
    setBusyProductId(product.id);
    setMessage("安全な決済依頼を作成しています。");
    try {
      const intentId = new URLSearchParams(window.location.search).get("intent");
      let intentHandoffProof: string | undefined;
      if (intentId) {
        const handoffResponse = await fetch(
          `/api/core/intents/${encodeURIComponent(intentId)}/handoff`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ service: "commerce" }),
          },
        );
        const handoffBody = (await handoffResponse.json().catch(() => null)) as
          | { proof?: string; error?: string }
          | null;
        if (!handoffResponse.ok || !handoffBody?.proof)
          throw new Error(handoffBody?.error ?? "intent_handoff_unavailable");
        intentHandoffProof = handoffBody.proof;
      }
      const response = await fetch(
        commerceApiUrl(
          `/products/${encodeURIComponent(product.id)}/payment-request`,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quantity: 1,
            billingCountry,
            currency: asset.currency,
            chainId: asset.chainId,
            ...(intentHandoffProof ? { intentHandoffProof } : {}),
          }),
        },
      );
      const body = (await response.json()) as PaymentRequestResponse;
      if (!response.ok || !body.paymentRequest?.token)
        throw new Error(body.error ?? "payment_request_failed");
      navigateHubRoute(
        `/wallet/pay?request=${encodeURIComponent(body.paymentRequest.token)}${
          intentId ? `&intent=${encodeURIComponent(intentId)}` : ""
        }`,
      );
    } catch (error) {
      setMessage(
        `決済画面を準備できませんでした: ${
          error instanceof Error ? error.message : "commerce_unavailable"
        }`,
      );
      setBusyProductId(null);
    }
  }

  return (
    <section className="digital-commerce">
      <header className="digital-commerce__header">
        <div>
          <h1>デジタル商品</h1>
          <span>価格と税を確認してから、共通の決済画面で支払います。</span>
        </div>
        <a href={hubSurfacePath(surface, "/market")}>商品を探す</a>
      </header>
      {loading ? (
        <SkeletonList kind="tile" count={6} label="商品を読み込んでいます" />
      ) : (
        <p className="digital-commerce__status" role="status" aria-live="polite">
          {message}
        </p>
      )}
      <section className="digital-commerce__grid" aria-label="デジタル商品一覧">
        {products.map((product) => (
          <article className="digital-commerce__card" key={product.id}>
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="digital-commerce__placeholder" aria-hidden="true">
                ◇
              </div>
            )}
            <div>
              <small>{product.seller.publicName}</small>
              <h2>{product.title}</h2>
              <p>{product.description}</p>
              {product.taxIncluded?.status === "determined" ? (
                <>
                  <strong>
                    {product.taxIncluded.priceJpyc.toLocaleString()} JPYC <span>（税込）</span>
                  </strong>
                  <small>本体 {product.priceJpyc.toLocaleString()} JPYC</small>
                </>
              ) : (
                <>
                  <strong>{product.priceJpyc.toLocaleString()} JPYC</strong>
                  <small>税は注文時に確定</small>
                </>
              )}
              <a
                href={product.seller.legalDisplayUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                販売条件・法定表示
              </a>
              <button
                type="button"
                disabled={busyProductId !== null}
                onClick={() => void purchase(product)}
              >
                {busyProductId === product.id
                  ? "決済画面を準備中"
                  : "価格を確認して支払う"}
              </button>
            </div>
          </article>
        ))}
      </section>
      <section
        className="digital-commerce__tax"
        aria-label="請求先国"
      >
        <label>
          <span>請求先国</span>
          <input
            value={country}
            maxLength={2}
            autoComplete="country"
            aria-label="請求先国の2文字コード"
            onChange={(event) => setCountry(event.target.value.toUpperCase())}
          />
        </label>
        <p>支払い時にCommerceが接続国と照合します。IPアドレス自体はHubへ保存しません。</p>
      </section>
    </section>
  );
}
