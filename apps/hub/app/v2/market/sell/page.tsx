import type { Metadata } from "next";

import { MarketSellTypeNav } from "@/components/market-sell-type-nav";
import { V2MarketShell } from "@/components/v2/v2-market-shell";

import "../../v2.css";
import "../../market-sell.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "出品する | マーケット | Hub v2" };

/*
 * 出品の種類を選ぶ画面（2026-09-04、旦那様の「古いUIを出さない」）。
 * 選ばせるだけなので、既存の MarketSellTypeNav をそのまま置く。
 * 行き先は面を渡して v2 の中に留める。v2 に無い種類は既存の面へ渡る。
 */
export default function V2MarketSellPage() {
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market" title="出品する">
      <div className="v2-account__panels v2-market__panels">
        <MarketSellTypeNav detailed surface="/v2" pageHeading="出品する" />
      </div>
    </V2MarketShell>
  );
}
