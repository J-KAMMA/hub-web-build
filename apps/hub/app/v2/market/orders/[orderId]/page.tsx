import type { Metadata } from "next";

import { CommerceOrderTracker } from "@/components/commerce-order-tracker";
import { V2MarketShell } from "@/components/v2/v2-market-shell";

import "../../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "注文詳細 | マーケット | Hub v2" };

/*
 * 注文の詳細。既存の CommerceOrderTracker（配送の追跡とエスクローの操作）を
 * そのまま置く。決済に触る部品なので作り直さない。
 *
 * v2 にこの画面が無かったので、注文一覧から1件を押すと既存の画面へ出ていた。
 * 一覧は /v2/market/orders に在るのに、その先だけ v1 だった。
 */
export default async function V2MarketOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market/orders" title="注文詳細">
      <div className="v2-account__panels v2-market__panels">
        <CommerceOrderTracker orderId={orderId} />
      </div>
    </V2MarketShell>
  );
}
