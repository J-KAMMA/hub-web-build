import type { Metadata } from "next";

import { MarketSellTypeNav } from "@/components/market-sell-type-nav";
import { V2MarketShell } from "@/components/v2/v2-market-shell";

import "../../../v2.css";
import "../../../market-sell.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "デジタルを出品 | マーケット | Hub v2" };

/*
 * デジタルの出品（2026-09-04、旦那様の「古いUIを出さない」）。
 * 登録・公開・利用権の画面は Vault と共に Hub から外した（2026-10-15）。
 */
export default function V2MarketDigitalSellPage() {
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market" title="デジタルを出品">
      <div className="v2-account__panels v2-market__panels">
        <MarketSellTypeNav current="digital" surface="/v2" pageHeading="デジタルを出品" />
      </div>
    </V2MarketShell>
  );
}
