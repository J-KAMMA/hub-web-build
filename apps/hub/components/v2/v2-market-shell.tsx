import Link from "next/link";
import type { ReactNode } from "react";

import "@/app/v2/redesign-market.css";
import { ButtonLink } from "@/components/v2/ui/button";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Icon } from "@/components/v2/v2-icons";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";

/*
 * マーケットの詳細画面（商品・検索・カート・注文・購入済み）の共通の枠。
 * 見出しの脇に出品（主）とカート・注文（副）、直下に目録タブ（7つ以内）。
 * 仕事と求人は構想 第7章のとおり別の入口として並べる（単一の法的・決済モデルにしない）。
 * タブに入らない入口は末尾の「ほかの入口」へ置く。
 */
const TABS = [
  { href: "/v2/market", ja: "マーケット", en: "Market" },
  { href: "/v2/market/products", ja: "Hubの商品", en: "Hub products" },
  { href: "/v2/market/purchased", ja: "購入済み", en: "Purchased" },
  { href: "/v2/market/tickets", ja: "チケット", en: "Tickets" },
  { href: "/v2/market/digital", ja: "デジタル", en: "Digital" },
  { href: "/v2/work", ja: "依頼・スキル", en: "Work" },
  { href: "/v2/jobs", ja: "求人", en: "Jobs" },
] as const;

/* 目録タブの「その他」へ畳む入口。掲載の一覧（講座・イベント・旅行・地域サービス）も市場の目録の下に置く。 */
const MORE = [
  { href: "/v2/market/products/search", ja: "実物を探す", en: "Search products" },
  { href: "/v2/classes", ja: "講座", en: "Classes" },
  { href: "/v2/events", ja: "イベント", en: "Events" },
  { href: "/v2/travel", ja: "旅行", en: "Travel" },
  { href: "/v2/local-services", ja: "地域サービス", en: "Local services" },
  { href: "/market/games", ja: "ゲーム", en: "Games" },
] as const;

/* 現在地に当たる入口。いちばん長く一致する href を選ぶ（/v2/market/digital/sell はデジタル）。 */
export function activeMarketHref(currentPath: string): string | null {
  const path = currentPath.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: string | null = null;
  for (const { href } of [...TABS, ...MORE]) {
    if ((path === href || path.startsWith(href + "/")) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

/* 見出しの操作。主は「出品する」の1つだけ。カートと注文は記号のボタン（名前は title と aria に持つ）。 */
export function MarketHeaderActions({ japanese, sell = true }: { japanese: boolean; sell?: boolean }) {
  return (
    <span className="v2-market-actions">
      {sell ? <ButtonLink variant="primary" href="/v2/market/sell" label={japanese ? "出品する" : "Sell"} /> : null}
      <ButtonLink variant="icon" href="/v2/market/cart" label={japanese ? "カート" : "Cart"} icon={<V2Icon name="store" />} />
      <ButtonLink variant="icon" href="/v2/market/orders" label={japanese ? "注文" : "Orders"} icon={<V2Icon name="list" />} />
    </span>
  );
}

/* 目録タブ。市場の全頁で同じ並び。入口が多いので残りは「その他」に畳む。 */
export function V2MarketTabs({ currentPath, japanese, showMore = true }: { currentPath: string; japanese: boolean; showMore?: boolean }) {
  const active = activeMarketHref(currentPath);
  const moreActive = MORE.some((page) => page.href === active);
  return (
    <ul className="v2-nav__list">
      {TABS.map((page) => (
        <li key={page.href}><Link className="v2-nav__item" href={page.href} aria-current={page.href === active ? "page" : undefined}><span className="v2-nav__label">{japanese ? page.ja : page.en}</span></Link></li>
      ))}
      {showMore ? (
        <li>
          <details open={moreActive || undefined}>
            <summary className="v2-nav__item" aria-current={moreActive ? "true" : undefined}><span className="v2-nav__label">{japanese ? "その他" : "More"}</span></summary>
            <ul className="v2-nav__list v2-nav__list--nested">
              {MORE.map((page) => (
                <li key={page.href}><Link className="v2-nav__item" href={page.href} aria-current={page.href === active ? "page" : undefined}><span className="v2-nav__label">{japanese ? page.ja : page.en}</span></Link></li>
              ))}
            </ul>
          </details>
        </li>
      ) : null}
    </ul>
  );
}

export async function V2MarketShell({ currentPath, title, note, action, panelOwnsHeading = false, wide = false, showMore = true, sellAction = true, children }: {
  currentPath: string;
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  /* 見出しは全頁で枠が出す。本文が同じ見出しを持つときは、本文側のh1を隠して重複させない。 */
  panelOwnsHeading?: boolean;
  /* 既存の横断検索は本体が広い前提（2列の格子と250pxの札）。右列を出さず本文を広げる。 */
  wide?: boolean;
  /* 末尾の「ほかの入口」。市場の外の一覧（講座・イベントなど）では出さない。 */
  showMore?: boolean;
  /* 本文が自分の主操作（情報を掲載・依頼を出す）を持つ頁では false。見出しの主は頁に1つだけにする。 */
  sellAction?: boolean;
  children: ReactNode;
}) {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  return (
    <V2Shell skin="luxe"
      currentPath={currentPath}
      pageTitle={title}
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "マーケット" : "Market"}
      directory={<V2MarketTabs currentPath={currentPath} japanese={japanese} showMore={showMore} />}
      aside={wide ? undefined : <V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={title}
        action={action ?? <MarketHeaderActions japanese={japanese} sell={sellAction} />}
      />
      {note ? <p className="v2-note">{note}</p> : null}
      {panelOwnsHeading ? <div className="v2-market-body" data-panel-heading>{children}</div> : children}
    </V2Shell>
  );
}
