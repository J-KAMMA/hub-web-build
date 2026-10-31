import type { Metadata } from "next";

import { DigitalCommerce } from "@/components/digital-commerce";
import { UnifiedArticleDirectory } from "@/components/unified-article-directory";
import { V2MarketShell } from "@/components/v2/v2-market-shell";

import "../../../articles/articles.css";
import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "デジタル | マーケット | Hub v2" };

/*
 * デジタルの一覧。販売者が Commerce に登録したデジタル商品を出す（2026-10-15）。
 * 販売中の記事は ?view=articles。Vault を外したので、これまでの「何も無い一覧」は置かない。
 */
export default async function V2MarketDigitalPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  return (
    <V2MarketShell panelOwnsHeading currentPath="/v2/market/digital" title="デジタル商品">
      <div className="v2-account__panels v2-market__panels">
        {view === "articles" ? <UnifiedArticleDirectory publicArticles={[]} marketMode /> : <DigitalCommerce />}
      </div>
    </V2MarketShell>
  );
}
