import type { Metadata } from "next";

import { PhysicalCommerce } from "@/components/physical-commerce";
import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { getHubLocale } from "@/lib/server/locale";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "カート | マーケット | Hub v2",
};

/* 購入の画面は決済の規則（承認まで送らない等）を持つ既存の部品をそのまま置く。 */
export default async function V2MarketCartPage() {
  const japanese = (await getHubLocale()) === "ja";
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market/cart" title={japanese ? "カート" : "Cart"}>
      <div className="v2-account__panels v2-market__panels">
        <PhysicalCommerce view="cart" />
      </div>
    </V2MarketShell>
  );
}
