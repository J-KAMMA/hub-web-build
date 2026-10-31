import type { Metadata } from "next";

import { GateUnlockList } from "@/components/gate-unlock-list";
import { PurchasedLibrary } from "@/components/purchased-library";
import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { getHubLocale } from "@/lib/server/locale";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "購入済み | マーケット | Hub v2",
};

export default async function V2MarketPurchasedPage() {
  const japanese = (await getHubLocale()) === "ja";
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market/purchased" title={japanese ? "購入済み" : "Purchased"}>
      <div className="v2-account__panels v2-market__panels">
        <PurchasedLibrary />
        <GateUnlockList />
      </div>
    </V2MarketShell>
  );
}
