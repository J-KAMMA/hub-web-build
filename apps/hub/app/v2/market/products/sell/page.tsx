import type { Metadata } from "next";

import { CommerceSellerDashboard } from "@/components/commerce-seller-dashboard";
import { MarketSellTypeNav } from "@/components/market-sell-type-nav";
import { V2MarketShell } from "@/components/v2/v2-market-shell";

import "../../../v2.css";
import "../../../market-sell.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "商品を販売する | マーケット | Hub v2" };

/*
 * 実物商品の出品（2026-09-04、旦那様の「古いUIを出さない」）。
 * 登録・在庫・送料・販売者確認は CommerceSellerDashboard が持っている。
 * 決済と本人確認に触るので作り直さない。
 */
export default function V2MarketProductsSellPage() {
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market" title="商品を販売する">
      <div className="v2-account__panels v2-market__panels">
        <MarketSellTypeNav current="physical" surface="/v2" pageHeading="商品を販売する" />
        <CommerceSellerDashboard />
      </div>
    </V2MarketShell>
  );
}
