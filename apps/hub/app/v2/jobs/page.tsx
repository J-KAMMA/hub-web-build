import type { Metadata } from "next";

import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { WorkListingsMarketplace } from "@/components/work-listings-marketplace";
import { getHubLocale } from "@/lib/server/locale";

import "../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "求人 | Hub v2",
};

/*
 * 求人（2026-09-04）。v2 に無かった最後の仕事の面。
 *
 * 構想（docs/HUB_SYSTEM_MAP.md 第7章）は「Hub Workは仕事に関する一つの発見画面である。
 * **ただし、求人、業務委託、共同開発、研究協力を単一の法的・決済モデルにはしない**」と
 * 書いている。だから /v2/work（依頼・スキル）へ寄せて済ませない。部品は同じでも
 * mode が違い、応募と雇用条件の扱いが変わる。
 *
 * 既存の /jobs と同じ WorkListingsMarketplace を mode="jobs" で置く。
 * 部品が自分の h1 を持つので列の頭は h1 にしない。本体が広い前提なので右列は出さない。
 */
export default async function V2JobsPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string; create?: string }> }) {
  const [{ category = "all", q = "", create }, locale] = await Promise.all([searchParams, getHubLocale()]);
  const japanese = locale === "ja";
  return (
    <V2MarketShell sellAction={false} panelOwnsHeading currentPath="/v2/jobs" title={japanese ? "求人" : "Jobs"}>
      <div className="v2-account__panels v2-market__panels">
        <WorkListingsMarketplace mode="jobs" initialCategory={category} initialQuery={q} initialCreate={create === "1"} />
      </div>
    </V2MarketShell>
  );
}
