import type { Metadata } from "next";
import Link from "next/link";

import { MarketHomeProducts } from "@/components/v2/market-home-products";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { MarketHeaderActions, V2MarketTabs } from "@/components/v2/v2-market-shell";
import { V2Shell } from "@/components/v2/v2-shell";
import { PUBLIC_LISTING_KIND_LABELS, type PublicListing } from "@/lib/public-listings";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listD1PublicListings } from "@/lib/server/d1-public-listings";
import { listD1WorkListings } from "@/lib/server/d1-work-listings";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { listMarketTicketEvents, type MarketTicketEvent } from "@/lib/server/market-tickets";
import { v2NavItems } from "@/lib/v2-nav";
import { relativeTime } from "@/lib/v2-time";
import type { WorkListing } from "@/lib/work-listings";

import "../../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";
import "../../redesign-market.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "マーケット | Hub v2",
};

type Section = "tickets" | "publicListings" | "workListings";

/*
 * v2 のマーケットのTOP。既存の /market には触れない。
 *
 * 載せるのは利用者の出品だけ（2026-10-15、外部ショップの商品とアフィリエイトを外した）:
 * Hub内で買える商品（Commerce）・デジタル（Commerce）・予約とチケット・仕事。
 * 節ごとに別々に読み、落ちた節はその節だけ「取得できません」にする。
 * 税は計算しない。札は「¥N〜」。
 */
export default async function V2MarketPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const database = getOptionalHubD1();
  const unavailable = new Set<Section>();
  const read = async <T,>(section: Section, reader: () => Promise<T>, fallback: T): Promise<T> => {
    if (!database) { unavailable.add(section); return fallback; }
    try {
      return await reader();
    } catch {
      unavailable.add(section);
      return fallback;
    }
  };

  const [shell, tickets, publicListings, workListings] = await Promise.all([
    getAppShellData(),
    read<MarketTicketEvent[]>("tickets", () => listMarketTicketEvents(database!), []),
    read<PublicListing[]>("publicListings", () => listD1PublicListings(database!, { limit: 24 }), []),
    read<WorkListing[]>("workListings", () => listD1WorkListings(database!, null), []),
  ]);

  const bookings = publicListings.filter((listing) => listing.kind !== "local-services").slice(0, 6);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  /* 3つの節がすべて空で、取得失敗も無いときだけ、商品の節がページ全体の空表示を出す。 */
  const othersEmpty = unavailable.size === 0 && !tickets.length && !bookings.length && !workListings.length;

  const library = await loadViewerLibrary(shell.currentProfile.id, "market", japanese);
  const directory = <><V2MarketTabs currentPath="/v2/market" japanese={japanese} /><V2LibraryColumn data={library} signedIn={Boolean(shell.currentProfile.id)} japanese={japanese} next="/v2/market" /></>;

  const sectionNote = (section: Section, count: number) =>
    unavailable.has(section) ? (japanese ? "取得できません" : "Unavailable") : (japanese ? `${count}件` : `${count}`);

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/market"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "マーケット" : "Market"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "マーケット" : "Market"}
        action={<MarketHeaderActions japanese={japanese} />}
      />

      {/* 商品（Commerce）とデジタル。他の節も空なら、ページ全体で1つの空表示になる。 */}
      <MarketHomeProducts japanese={japanese} othersEmpty={othersEmpty} />

      {/* 予約・チケット */}
      <section id="v2-market-tickets" className="v2-msec v2-msec--rest" aria-labelledby="v2-market-tickets-title">
        <header className="v2-msec__head">
          <h2 id="v2-market-tickets-title" className="v2-column__title v2-column__title--section">{japanese ? "予約・チケット" : "Bookings & tickets"}</h2>
          <Link className="v2-card__link" href="/v2/market/tickets">{japanese ? "すべて見る" : "See all"}</Link>
        </header>
        {tickets.length || bookings.length ? (
          <ul className="v2-mitems">
            {tickets.slice(0, 6).map((event) => (
              <li key={event.id}>
                {/*
                  * 券の1件ごとの画面は v1 にも v2 にも無い（一覧の中で開く作り）。
                  * /market/tickets/<slug> は404だった。題で絞った一覧へ渡す（2026-09-04）。
                  */}
                <Link className="v2-mitem" href={`/v2/market/tickets?q=${encodeURIComponent(event.title)}`}>
                  <span className="v2-mitem__mark" aria-hidden="true">券</span>
                  <span className="v2-mitem__body">
                    <strong>{event.title}</strong>
                    <small>{event.venueName} · {new Date(event.startsAt).toLocaleDateString(japanese ? "ja-JP" : "en-US", { month: "short", day: "numeric" })}</small>
                  </span>
                  <span className="v2-mitem__value">
                    {event.ticketTypes[0] ? `¥${event.ticketTypes[0].priceMinor.toLocaleString("ja-JP")}${event.ticketTypes.length > 1 ? "〜" : ""}` : ""}
                  </span>
                </Link>
              </li>
            ))}
            {bookings.map((listing) => (
              <li key={listing.id}>
                <a className="v2-mitem" href={listing.providerUrl} target="_blank" rel="noopener noreferrer">
                  <span className="v2-mitem__mark" aria-hidden="true">予</span>
                  <span className="v2-mitem__body">
                    <strong>{listing.title}</strong>
                    <small>{PUBLIC_LISTING_KIND_LABELS[listing.kind]} · {listing.providerLabel} · {[listing.region, listing.locality].filter(Boolean).join(" ")}</small>
                  </span>
                  <span className="v2-mitem__value">{listing.priceLabel ?? ""}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : unavailable.has("tickets") || unavailable.has("publicListings") ? (
          <V2Empty title={japanese ? "予約・チケットを読み込めませんでした" : "Could not load bookings and tickets"} />
        ) : (
          /* 空の枠は1行にする。積み重ねた大きな空状態を出さない（監査 S8）。 */
          <p className="v2-note">{japanese ? "販売中のチケットはまだありません。イベントや予約枠を出品すると、ここに並びます。" : "No tickets on sale yet. Events and booking slots you list will appear here."}</p>
        )}
      </section>

      {/*
        * 仕事。行き先は v2 の画面へ。求人（/jobs）は v2 に無いので既存のまま。
        * 自動車と不動産はここに在ったが、掲載も問い合わせも0件で、構想にも位置づけが
        * 無かったので撤去した（2026-09-04、旦那様の判断）。
        */}
      {([
        { id: "v2-market-work", section: "workListings" as Section, ja: "仕事", en: "Work", href: "/v2/work", mark: "仕", rows: workListings.slice(0, 6).map((listing) => ({ id: listing.id, title: listing.title, meta: `${listing.ownerName} · ${listing.category} · ${listing.location}`, value: listing.compensationLabel, href: `${listing.kind === "job" ? "/v2/jobs" : "/v2/work"}?q=${encodeURIComponent(listing.title)}`, at: listing.publishedAt })) },
      ]).map((group) => (
        <section key={group.id} id={group.id} className="v2-msec v2-msec--rest" aria-labelledby={`${group.id}-title`}>
          <header className="v2-msec__head">
            <h2 id={`${group.id}-title`} className="v2-column__title v2-column__title--section">{japanese ? group.ja : group.en}</h2>
            {group.rows.length || unavailable.has(group.section) ? <span className="v2-msec__note">{sectionNote(group.section, group.rows.length)}</span> : null}
            <Link className="v2-card__link" href={group.href}>{japanese ? "すべて見る" : "See all"}</Link>
          </header>
          {group.rows.length ? (
            <ul className="v2-mitems">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <Link className="v2-mitem" href={row.href}>
                    <span className="v2-mitem__mark" aria-hidden="true">{group.mark}</span>
                    <span className="v2-mitem__body">
                      <strong>{row.title}</strong>
                      <small>{row.meta}{row.at ? ` · ${relativeTime(row.at, locale)}` : ""}</small>
                    </span>
                    <span className="v2-mitem__value">{row.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : unavailable.has(group.section) ? (
            <V2Empty title={japanese ? "仕事を読み込めませんでした" : "Could not load work listings"} />
          ) : (
            <p className="v2-note">{japanese ? "掲載中の仕事はまだありません。依頼や求人を出すと、ここに並びます。" : "No work listed yet. Requests and job posts you list will appear here."}</p>
          )}
        </section>
      ))}
    </V2Shell>
  );
}
