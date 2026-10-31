import Link from "next/link";
import React from "react";

import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import { hubSurfacePath, type HubUiSurface } from "@/lib/hub-surface-path";

import styles from "./market-sell-type-nav.module.css";

const sellTypes = [
  {
    id: "physical",
    label: "実物商品",
    description: "配送・受取がある商品",
    href: "/market/products/sell#products",
  },
  {
    id: "digital",
    label: "デジタル",
    description: "ダウンロード・閲覧作品",
    href: "/market/digital/sell",
  },
  {
    id: "tickets",
    label: "チケット",
    description: "イベントの入場券",
    href: "/market/tickets/sell",
  },
] as const;

const sellAreas = [
  {
    id: "products",
    icon: "store",
    label: "商品",
    description: "配送商品またはオンライン作品",
    actions: [
      { label: "実物", href: "/market/products/sell#products" },
      { label: "デジタル", href: "/market/digital/sell" },
    ],
  },
  {
    id: "booking",
    icon: "clock",
    label: "予約・チケット",
    description: "入場券、旅行、教室、イベント",
    actions: [
      { label: "チケット", href: "/market/tickets/sell" },
      { label: "旅行", href: "/travel?create=1" },
      { label: "教室", href: "/classes?create=1" },
      { label: "イベント", href: "/events?create=1" },
    ],
  },
  {
    id: "services",
    icon: "settings",
    label: "サービス",
    description: "地域・修理・美容・専門サービス",
    actions: [{ label: "サービスを掲載", href: "/local-services?create=1" }],
  },
  {
    id: "work",
    icon: "article",
    label: "仕事",
    description: "業務依頼、スキル出品、求人",
    actions: [
      { label: "依頼・スキル", href: "/work?create=1" },
      { label: "求人", href: "/jobs?create=1" },
    ],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  icon: V2IconName;
  label: string;
  description: string;
  actions: ReadonlyArray<{ label: string; href: string }>;
}>;

export function MarketSellTypeNav({
  current,
  detailed = false,
  surface = "",
  pageHeading,
}: {
  current?: (typeof sellTypes)[number]["id"];
  detailed?: boolean;
  /* 見ている面。サーバーの部品なので描く側が渡す。 */
  surface?: HubUiSurface;
  pageHeading?: string;
}) {
  return (
    <section
      className={styles.section}
      aria-labelledby="market-sell-type-title"
      data-detailed={detailed || undefined}
    >
      {pageHeading ? <h1 id="market-sell-type-title">{pageHeading}</h1> : <h2 id="market-sell-type-title">出品する</h2>}
      {detailed ? (
        <div className={styles.nav} aria-label="掲載するマーケットの領域">
          {sellAreas.map((area) => (
            <section className={styles.area} key={area.id}>
              <span className={styles.areaIcon} aria-hidden="true"><V2Icon name={area.icon} /></span>
              <strong>{area.label}</strong>
              <span>{area.description}</span>
              <nav aria-label={`${area.label}の掲載方法`}>
                {area.actions.map((action) => (
                  <Link href={hubSurfacePath(surface, action.href)} key={action.href}>
                    {action.label}
                  </Link>
                ))}
              </nav>
            </section>
          ))}
        </div>
      ) : (
        <nav className={styles.nav} aria-label="出品する商品の種類">
          {sellTypes.map((item) => (
            <Link
              key={item.id}
              href={hubSurfacePath(surface, item.href)}
              className={current === item.id ? styles.active : undefined}
              aria-current={current === item.id ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}
