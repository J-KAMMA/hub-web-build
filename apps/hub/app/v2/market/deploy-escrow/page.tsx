import type { Metadata } from "next";
import Link from "next/link";

import { PhysicalEscrowDeployer } from "@/components/physical-escrow-deployer";
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
  title: "エスクローコントラクトの配備 | Hub v2",
};

export default async function V2DeployEscrowPage() {
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
      </ul>
    </>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/market/deploy-escrow"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "配備" : "Deploy"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "エスクローコントラクトの配備" : "Deploy escrow contract"} />
      <PhysicalEscrowDeployer />
    </V2Shell>
  );
}
