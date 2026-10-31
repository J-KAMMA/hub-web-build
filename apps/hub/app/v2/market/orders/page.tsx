import type { Metadata } from "next";

import { PhysicalCommerce } from "@/components/physical-commerce";
import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { getHubLocale } from "@/lib/server/locale";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "注文・返品 | マーケット | Hub v2",
};

export default async function V2MarketOrdersPage() {
  const japanese = (await getHubLocale()) === "ja";
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market/orders" title={japanese ? "注文・返品" : "Orders and returns"}>
      <div className="v2-account__panels v2-market__panels">
        <PhysicalCommerce view="orders" />
      </div>
    </V2MarketShell>
  );
}
