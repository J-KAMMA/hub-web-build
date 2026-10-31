import type { Metadata } from "next";
import Link from "next/link";

import { ServicesDirectory } from "@/components/services-directory";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { getServicesPageState } from "@/lib/server/services-page-data";
import { HUB_SERVICES } from "@/lib/hub-services";
import { filterOptionalNav, hiddenServiceIds } from "@/lib/optional-services";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "サービス | Hub v2",
};

/*
 * Hub の各サービスの一覧。既存の ServicesDirectory をそのまま v2 の枠に置く。
 * preferV2 を渡して、v2 の画面が在るサービスは v2 のまま開くようにした（2026-09-04）。
 * ここは v2 で**入口が無い画面への唯一の入口**でもある（ストア・仕事・研究・計算・
 * ゲーム・意図・収益・広告・ノードなど、左列に無いもの）。
 */
export default async function V2ServicesPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const [shell, stateCounts] = await Promise.all([getAppShellData(), getServicesPageState()]);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "主なサービス" : "Key services"}</p>
      <ul className="v2-nav__list">
        {filterOptionalNav([
        { href: "/v2/store", label: japanese ? "ストア" : "Store" },
        { href: "/v2/work", label: japanese ? "仕事" : "Work" },
        { href: "/v2/research", label: japanese ? "研究" : "Research" },
        { href: "/v2/code", label: japanese ? "コード" : "Code" },
        { href: "/v2/intent", label: japanese ? "意図の実行" : "Intent" },
        { href: "/v2/earnings", label: japanese ? "収益" : "Earnings" },
        { href: "/v2/advertising", label: japanese ? "広告" : "Advertising" },
        { href: "/v2/token", label: japanese ? "トークン" : "Tokens" },
        ]).map((item) => (
          <li key={item.href}><Link className="v2-nav__item" href={item.href}><span className="v2-nav__label">{item.label}</span></Link></li>
        ))}
      </ul>
    </>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/services"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "すべての機能" : "All features"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "すべての機能" : "All features"} />
      <div className="v2-account__panels v2-market__panels">
        <ServicesDirectory
          notificationCount={shell.unreadIndicatorCount}
          profileHref={shell.currentProfile.id ? `/v2/profile/${encodeURIComponent(shell.currentProfile.handle)}` : "/auth"}
          stateCounts={stateCounts}
          preferV2
          hiddenServiceIds={hiddenServiceIds(HUB_SERVICES)}
        />
      </div>
    </V2Shell>
  );
}
