import type { Metadata } from "next";

import { CommerceProductPage } from "@/components/commerce-product-page";
import { V2MarketShell } from "@/components/v2/v2-market-shell";

import "../../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "商品 | マーケット | Hub v2" };

/*
 * 商品ページ（2026-10-18）。商品は Commerce の公開 API をブラウザから直接読む。
 * Hub のサーバーは商品・決済の中身を受け取らない（中継しない）。
 */
export default async function V2MarketProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  return (
    <V2MarketShell panelOwnsHeading wide currentPath="/v2/market/products" title="商品">
      <div className="v2-account__panels v2-market__panels">
        <CommerceProductPage productId={productId} />
      </div>
    </V2MarketShell>
  );
}
