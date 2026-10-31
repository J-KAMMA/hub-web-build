"use client";

import React, { useEffect, useState } from "react";
import { commerceApiUrl, commerceRequest } from "@/lib/commerce-client";
import {
  availablePhysicalProduct,
  productPriceLabels,
  productShippingLabel,
  productStockLabel,
  readPublicProduct,
  type Product,
} from "@/lib/commerce-product";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

const CART_KEY = "hub.shopping.cart.v1";
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/;

type CartItem = { productId: string; quantity: number };
function readCart(): CartItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter(
          (item): item is CartItem =>
            Boolean(item) &&
            typeof item.productId === "string" &&
            Number.isSafeInteger(item.quantity) &&
            item.quantity >= 1 &&
            item.quantity <= 20,
        )
      : [];
  } catch {
    return [];
  }
}

/*
 * 商品ページ（2026-10-18）。Desktop の商品詳細と同じ並び：左に絵、右に価格と購入の箱、説明は下に全幅。
 * 商品は Commerce の公開 API をブラウザから直接読む（Hub は中継しない）。支払いはカートから Commerce へ。
 */
export function CommerceProductPage({ productId }: { productId: string }) {
  const surface = useHubUiSurface();
  const [product, setProduct] = useState<Product | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [inCart, setInCart] = useState(false);

  useEffect(() => {
    if (!PRODUCT_ID.test(productId)) {
      setState("missing");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setState("loading");
    let authority = "";
    try {
      authority = commerceApiUrl("/");
    } catch {
      setState("error");
      return;
    }
    commerceRequest<Record<string, unknown>>(`/products/${encodeURIComponent(productId)}`, {
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
    })
      .then((body) => {
        if (controller.signal.aborted || commerceApiUrl("/") !== authority) return;
        const next = readPublicProduct(body.product, productId);
        setProduct(next);
        setInCart(readCart().some((item) => item.productId === next.id));
        setState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setState("error");
          return;
        }
        setState(error instanceof Error && error.message === "not_found" ? "missing" : "error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [productId, retry]);

  const productsHref = hubSurfacePath(surface, "/market/products");
  const cartHref = hubSurfacePath(surface, "/market/cart");

  if (state === "loading")
    return (
      <section className="commerce-product commerce-product--state" role="status">
        <strong>商品を読み込んでいます</strong>
      </section>
    );
  if (state === "missing" || !product)
    return (
      <section className="commerce-product commerce-product--state" role="status">
        {state === "error" ? (
          <>
            <strong>商品を読み込めませんでした</strong>
            <p>接続を確認して、もう一度お試しください。</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              もう一度試す
            </button>
          </>
        ) : (
          <>
            <strong>この商品は見つかりません</strong>
            <p>販売が終わったか、URLが違います。</p>
            <a href={productsHref}>商品を探す</a>
          </>
        )}
      </section>
    );

  const price = productPriceLabels(product);
  const tax = product.taxIncluded;
  const physical = ["seller_shipping", "platform_3pl"].includes(product.fulfillmentType);
  const buyable = availablePhysicalProduct(product);
  const stock = productStockLabel(product);
  const fulfillment =
    {
      seller_shipping: "販売者が発送",
      platform_3pl: "委託倉庫から発送",
      digital: "デジタル（購入後に受け取り）",
      pickup: "店頭で受け取り",
    }[product.fulfillmentType] ?? "";

  function addToCart() {
    if (!product || !buyable) return;
    const cart = readCart();
    if (!cart.some((item) => item.productId === product.id)) {
      cart.push({ productId: product.id, quantity: 1 });
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    }
    setInCart(true);
  }

  return (
    <article className="commerce-product">
      <div className="commerce-product__media">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.title} referrerPolicy="no-referrer" />
        ) : (
          <div className="commerce-product__placeholder" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="56" height="56">
              <path d="M6 8h12l-1 12H7L6 8Z" />
              <path d="M9 8V7a3 3 0 0 1 6 0v1" />
            </svg>
          </div>
        )}
      </div>
      <section className="commerce-product__buy" aria-label="価格と購入">
        <a className="commerce-product__seller" href={`${productsHref}?sellerId=${encodeURIComponent(product.seller.id)}`}>
          {product.seller.publicName}
        </a>
        <h1>{product.title}</h1>
        <p className="commerce-product__price">
          <strong>{price.main}</strong>
          <span>{price.mainSuffix}</span>
        </p>
        <p className="commerce-product__base">{price.note}</p>
        <dl className="commerce-product__facts">
          {physical ? (
            <div>
              <dt>送料</dt>
              <dd>{productShippingLabel(product).replace(/^送料 /, "")}</dd>
            </div>
          ) : null}
          {tax?.status === "determined" && physical ? (
            <div>
              <dt>1点のお支払い</dt>
              <dd>
                {tax.totalForOneJpyc.toLocaleString("ja-JP")} JPYC（税・送料込み）
              </dd>
            </div>
          ) : null}
          {stock ? (
            <div>
              <dt>在庫</dt>
              <dd data-low={(product.stockQuantity ?? 0) <= 3 ? "" : undefined}>{stock}</dd>
            </div>
          ) : null}
          {fulfillment ? (
            <div>
              <dt>受け取り</dt>
              <dd>{fulfillment}</dd>
            </div>
          ) : null}
          <div>
            <dt>税</dt>
            <dd>
              {tax?.status === "determined"
                ? `消費税 ${(tax.rateBps / 100).toLocaleString("ja-JP")}%（込み）`
                : "注文時にCommerceが確定"}
            </dd>
          </div>
        </dl>
        {buyable ? (
          inCart ? (
            <a className="commerce-product__primary" href={cartHref}>
              カートを見る
            </a>
          ) : (
            <button type="button" className="commerce-product__primary" onClick={addToCart}>
              カートに入れる
            </button>
          )
        ) : product.fulfillmentType === "digital" ? (
          <a className="commerce-product__primary" href={hubSurfacePath(surface, "/market/digital")}>
            デジタルの売り場で買う
          </a>
        ) : (
          <p className="commerce-product__unavailable">
            {physical ? "在庫がありません" : "この画面では購入できません"}
          </p>
        )}
        <p className="commerce-product__note">
          支払いと注文はCommerceが扱います。住所はIdentityで確認し、Hubには保存されません。
        </p>
        <a
          className="commerce-product__legal"
          href={product.seller.legalDisplayUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          販売条件・返品（販売者のページ）↗
        </a>
      </section>
      {product.description ? (
        <section className="commerce-product__about">
          <h2>商品の説明</h2>
          <p>{product.description}</p>
        </section>
      ) : null}
    </article>
  );
}
