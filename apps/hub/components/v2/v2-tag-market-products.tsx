"use client";

import { useEffect, useRef, useState } from "react";
import { tagKeyFromSlug, tagSlug } from "@jkamma/content-tags";

import { MarketProductGrid } from "@/components/v2/market-home-products";
import { V2Button } from "@/components/v2/v2-button";
import { V2DetailSection } from "@/components/v2/v2-detail";
import { commerceApiUrl } from "@/lib/commerce-client";
import { readPublicProduct, type Product } from "@/lib/commerce-product";

/*
 * マーケットの商品（2026-10-29）：/v2/tag/[slug] の「マーケット」の中身。
 * Commerce の公開 API を、ブラウザが直接読む（Hub のハンドラーは中継しない）。
 * 返るのは公開・購入可能・非表示でない商品の公開項目だけ。失敗しても空でも何も描かない。
 * 価格は Commerce が返した税込額をそのまま出す。購入・カートには触れない。
 */
function parsePage(value: unknown): { products: Product[]; nextCursor: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { products?: unknown; nextCursor?: unknown };
  if (!Array.isArray(record.products)) return null;
  const products: Product[] = [];
  for (const raw of record.products) {
    const item = raw as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    try {
      // この API は説明・在庫・出品者ID・販売条件URLを返さない（販売条件は商品ページで出す）。一覧の札に要る項目だけを検証して札の型へ詰める。
      products.push(
        readPublicProduct({
          id: item.id,
          title: item.title,
          description: "",
          imageUrl: item.imageUrl ?? null,
          priceJpyc: item.priceJpyc,
          shippingJpyc: item.shippingJpyc ?? null,
          stockQuantity: null,
          fulfillmentType: item.fulfillmentType,
          gasPayerPolicy: "merchant",
          gasSponsorThresholdJpy: null,
          ...(item.taxIncluded === undefined ? {} : { taxIncluded: item.taxIncluded }),
          seller: { id: "public", publicName: item.sellerPublicName, legalDisplayUrl: new URL(`/v2/market/products/${encodeURIComponent(String(item.id))}`, window.location.origin).href },
        }),
      );
    } catch {
      // 形が合わない1件は捨てる。
    }
  }
  return { products, nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null };
}

export function V2TagMarketProducts({
  slug,
  limit = 12,
  japanese = true,
  sectionTitle,
}: {
  slug: string;
  limit?: number;
  japanese?: boolean;
  /** 単独で使うときだけ見出しを付ける。商品があるときだけ出る。 */
  sectionTitle?: string;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  async function load(after: string | null) {
    setBusy(true);
    try {
      const key = tagKeyFromSlug(slug);
      const safeSlug = key ? tagSlug(key) : null;
      if (!safeSlug) return;
      const query = new URLSearchParams({ limit: String(limit) });
      if (after) query.set("cursor", after);
      const response = await fetch(`${commerceApiUrl(`/products/by-tag/${safeSlug}`)}?${query}`, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      if (!response.ok) return;
      const page = parsePage(await response.json().catch(() => null));
      if (!page) return;
      setProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        return [...current, ...page.products.filter((product) => !seen.has(product.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // 失敗は閉じる：何も描かない。
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!products.length) return null;
  const body = (
    <div data-testid="tag-market-products">
      <MarketProductGrid products={products} />
      {cursor ? (
        <V2Button variant="text" onClick={() => void load(cursor)} disabled={busy} label={japanese ? "さらに表示" : "Show more"} />
      ) : null}
    </div>
  );
  return sectionTitle ? <V2DetailSection title={sectionTitle}>{body}</V2DetailSection> : body;
}
