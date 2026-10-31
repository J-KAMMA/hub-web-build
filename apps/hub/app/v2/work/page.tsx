import type { Metadata } from "next";

import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { WorkListingsMarketplace } from "@/components/work-listings-marketplace";
import { getHubLocale } from "@/lib/server/locale";

import "../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "依頼・スキル | Hub v2",
};

/*
 * 仕事（依頼とスキル出品、応募、契約）。既存の WorkListingsMarketplace（2,390行。
 * 応募・契約・支払いの規則を持つ）をそのまま v2 の枠に置く。/jobs も同じ部品。
 * 部品が自分の h1 を持つので列の頭は h1 にしない。本体が広い前提なので右列は出さない。
 */
export default async function V2WorkPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string; create?: string }> }) {
  const [{ category = "all", q = "", create }, locale] = await Promise.all([searchParams, getHubLocale()]);
  const japanese = locale === "ja";
  return (
    <V2MarketShell sellAction={false} panelOwnsHeading currentPath="/v2/work" title={japanese ? "依頼・スキル" : "Work"}>
      <div className="v2-account__panels v2-market__panels">
        <WorkListingsMarketplace initialCategory={category} initialQuery={q} initialCreate={create === "1"} />
      </div>
    </V2MarketShell>
  );
}
