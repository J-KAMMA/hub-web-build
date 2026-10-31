import { PublicListingsMarket } from "@/components/public-listings-market";
import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { listD1PublicListings } from "@/lib/server/d1-public-listings";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";

/*
 * 公開の掲載（イベント・講座・旅行・地域サービス）は同じ部品（PublicListingsMarket）で、
 * 種別だけが違う。組み立てはここ1つ。部品が h1 を持つので列の頭は h1 にせず、
 * 本体が広い前提なので右列は出さない。
 */
export type V2ListingKind = "events" | "classes" | "travel" | "local-services";

const TITLES: Record<V2ListingKind, { ja: string; en: string }> = {
  events: { ja: "イベント", en: "Events" },
  classes: { ja: "講座", en: "Classes" },
  travel: { ja: "旅行", en: "Travel" },
  "local-services": { ja: "地域サービス", en: "Local services" },
};

export async function V2ListingsPage({ kind, searchParams }: { kind: V2ListingKind; searchParams: Promise<{ category?: string; q?: string; create?: string; listing?: string }> }) {
  const [{ category = "all", q = "", create, listing }, locale] = await Promise.all([searchParams, getHubLocale()]);
  const japanese = locale === "ja";
  const database = getOptionalHubD1();
  const listings = database ? await listD1PublicListings(database, { kind }).catch(() => []) : [];
  return (
    <V2MarketShell wide sellAction={false} panelOwnsHeading currentPath={`/v2/${kind}`} title={japanese ? TITLES[kind].ja : TITLES[kind].en}>
      <div className="v2-account__panels v2-market__panels">
        <PublicListingsMarket kind={kind} initialListings={listings} initialCategory={category} initialQuery={q} initialCreateOpen={create === "1"} initialListingId={kind === "events" ? listing ?? "" : ""} />
      </div>
    </V2MarketShell>
  );
}
