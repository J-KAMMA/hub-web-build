import type { Metadata } from "next";
import Link from "next/link";

import { FederatedProductCheckout } from "@/components/federated-product-checkout";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "連合商品 | Hub v2",
  description: "販売者ノードの商品をHub内で確認し、署名付き見積もりを取得します。",
};

export default async function V2FederatedProductPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string }>;
}) {
  const listing = (await searchParams).listing?.trim().slice(0, 512) ?? "";
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "マーケット" : "Market"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/market"><span className="v2-nav__label">{japanese ? "商品" : "Products"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/market/sell"><span className="v2-nav__label">{japanese ? "売る" : "Sell"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/market/orders"><span className="v2-nav__label">{japanese ? "注文" : "Orders"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/market/federated"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "連合商品" : "Federated"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "連合商品" : "Federated product"} />
      <FederatedProductCheckout listingUrl={listing} />
    </V2Shell>
  );
}
