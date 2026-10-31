import type { Metadata } from "next";

import { PhysicalCommerce } from "@/components/physical-commerce";
import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { getHubLocale } from "@/lib/server/locale";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "商品 | マーケット | Hub v2",
};

/* Hub内で買える商品（Commerce）の一覧。カート・支払いは既存の部品が持つ。 */
export default async function V2MarketProductsPage() {
  const japanese = (await getHubLocale()) === "ja";
  return (
    <V2MarketShell
      panelOwnsHeading
      currentPath="/v2/market/products"
      title={japanese ? "Hubの商品" : "Hub products"}
    >
      <div className="v2-account__panels v2-market__panels">
        <PhysicalCommerce view="products" />
      </div>
    </V2MarketShell>
  );
}
