import type { Metadata } from "next";
import Link from "next/link";

import { MarketTicketSystem } from "@/components/market-ticket-system";
import { V2MarketShell } from "@/components/v2/v2-market-shell";
import { resolveHubCategoryIds } from "@/lib/hub-taxonomy";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listMarketTicketEvents } from "@/lib/server/market-tickets";

import "../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "チケット | マーケット | Hub v2", description: "主催者が直接販売するイベントチケットを探して申し込めます。" };

/* イベントのチケット。絞り込みの計算は既存の /market/tickets と同じ。画面は既存の MarketTicketSystem。 */
export default async function V2MarketTicketsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const database = getOptionalHubD1();
  const params = await searchParams;
  const query = (params.q?.trim() ?? "").toLocaleLowerCase("ja-JP");
  const category = params.category?.trim() || "all";
  const loadedEvents = database ? await listMarketTicketEvents(database).catch(() => []) : [];
  const events = loadedEvents.filter((event) => {
    const text = `${event.title} ${event.summary} ${event.venueName}`;
    return (!query || text.toLocaleLowerCase("ja-JP").includes(query))
      && (category === "all" || resolveHubCategoryIds(event.title, event.summary, event.venueName).includes(category as ReturnType<typeof resolveHubCategoryIds>[number]));
  });
  return (
    <V2MarketShell
      wide
      currentPath="/v2/market/tickets"
      title="チケット"
      /*
       * 出品の入口（2026-09-04）。/v2/market/tickets/sell は画面が在るのに
       * どこからも指されていなかった。券を出すのはこの画面に立った人の用なので、
       * 全画面の並びではなくここに置く。
       * 入場確認（/v2/market/tickets/check-in）は会場での運営操作なので、
       * ここには出さない。流れの途中でだけ開く画面として残す。
       */
      action={(
        <>
          {/* action を渡すと note は出ないので、件数もここで出す。 */}
          <span className="v2-heading__note">{events.length}件</span>
          <Link className="v2-card__link" href="/v2/market/tickets/sell">チケットを出品</Link>
        </>
      )}
    >
      <MarketTicketSystem initialEvents={events} basePath="/v2/market/tickets" />
    </V2MarketShell>
  );
}
