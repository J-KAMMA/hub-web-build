"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { SkeletonList } from "@/components/v2/ui/skeleton";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2State } from "@/components/v2/v2-state";
import { commerceRequest } from "@/lib/commerce-client";
import {
  availablePhysicalProduct,
  productPriceLabels,
  productShippingLabel,
  readPublicProduct,
  type Product,
} from "@/lib/commerce-product";

/*
 * マーケットTOPの商品の札（2026-10-29）。
 * 公開の商品一覧を Commerce から直接読むだけで、カート・支払いには触れない。
 * 価格は Commerce が返した税込額をそのまま出す（Hub は計算しない）。
 * 札の見た目は商品一覧（physical-product-card）と同じ。
 */
export function MarketProductGrid({ products }: { products: Product[] }) {
  return (
    <ul className="v2-pgrid" data-market-products>
      {products.map((product) => {
        const price = productPriceLabels(product);
        const href = `/v2/market/products/${encodeURIComponent(product.id)}`;
        return (
          <li key={product.id}>
            <article className="digital-commerce__card physical-product-card">
              <Link className="physical-product-card__media" href={href} aria-label={`${product.title}の商品ページ`} tabIndex={-1}>
                {product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <div className="digital-commerce__placeholder" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="32" height="32"><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8V7a3 3 0 0 1 6 0v1" /></svg>
                  </div>
                )}
              </Link>
              <div>
                <h3><Link href={href}>{product.title}</Link></h3>
                <small>{product.seller.publicName}</small>
                <strong className="physical-product-card__price">{price.main}<span>{price.mainSuffix}</span></strong>
                <small className="physical-product-card__base">{price.note}</small>
                <small className="physical-product-card__sub"><span>{productShippingLabel(product)}</span></small>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/*
 * 商品の節（見出し込み）。他の節（チケット・仕事）も空のときだけ、ページ全体で1つの空表示にする。
 * 他の節は .v2-msec--rest を持ち、[data-market-empty] があれば redesign-market.css が隠す。
 */
export function MarketHomeProducts({ japanese = true, othersEmpty = false }: { japanese?: boolean; othersEmpty?: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setState("loading");
    commerceRequest<Record<string, unknown>>("/products?kind=physical", { signal: controller.signal, credentials: "omit", redirect: "error" })
      .then((body) => {
        if (!Array.isArray(body.products)) throw Error("invalid_public_product");
        setProducts(body.products.map((item) => readPublicProduct(item)).filter(availablePhysicalProduct).slice(0, 8));
        setState("ready");
      })
      .catch(() => { if (!controller.signal.aborted || state === "loading") setState("error"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry]);

  const section = (body: ReactNode) => (
    <section id="v2-market-products" className="v2-msec" aria-labelledby="v2-market-products-title">
      <header className="v2-msec__head">
        <h2 id="v2-market-products-title" className="v2-column__title v2-column__title--section">{japanese ? "商品" : "Products"}</h2>
        <Link className="v2-card__link" href="/v2/market/digital">{japanese ? "デジタル商品" : "Digital"}</Link>
        <Link className="v2-card__link" href="/v2/market/products">{japanese ? "すべて見る" : "See all"}</Link>
      </header>
      {body}
    </section>
  );

  if (state === "loading")
    return section(<SkeletonList kind="tile" count={4} label={japanese ? "商品を読み込んでいます" : "Loading products"} />);
  if (state === "error")
    return section(
      <V2Empty
        title={japanese ? "商品を読み込めませんでした" : "Could not load products"}
        note={japanese ? "接続を確認して、もう一度お試しください。" : "Check your connection and try again."}
        action={{ label: japanese ? "もう一度試す" : "Retry", onClick: () => setRetry((n) => n + 1) }}
      />
    );
  if (!products.length && othersEmpty)
    return (
      <div className="v2-market-empty" data-market-empty>
        <V2State
          kind="empty"
          icon="store"
          title={japanese ? "マーケットにはまだ何も並んでいません" : "Nothing is listed in the market yet"}
          note={japanese ? "商品・チケット・仕事を出品すると、ここに並びます。" : "Products, tickets and work you list will appear here."}
          action={{ label: japanese ? "出品する" : "Sell", href: "/v2/market/sell" }}
        />
      </div>
    );
  if (!products.length)
    return section(
      <V2Empty
        title={japanese ? "販売中の商品はまだありません" : "No products on sale yet"}
        note={japanese ? "販売者が商品を公開するとここに並びます。" : "Products appear here once sellers publish them."}
        action={{ label: japanese ? "出品する" : "Sell", href: "/v2/market/sell" }}
      />
    );
  return section(<MarketProductGrid products={products} />);
}
