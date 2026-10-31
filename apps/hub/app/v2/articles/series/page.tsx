import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2SeriesManager } from "@/components/v2/v2-series-manager";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-article-series.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "シリーズの管理 | Hub v2", robots: { index: false } };

/* 著者のシリーズ管理。自分の公開記事だけを順番に束ねる。 */
export default async function V2SeriesManagePage() {
  const [shell, locale] = await Promise.all([getAppShellData(), getHubLocale()]);
  const japanese = locale === "ja";
  const viewerId = shell.currentProfile.id || null;
  return (
    <V2Shell skin="luxe"
      currentPath="/v2/articles"
      profile={shell.currentProfile}
      items={v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount })}
      directoryTitle={japanese ? "記事" : "Articles"}
      directory={<ul className="v2-nav__list"><li><Link className="v2-nav__item" href="/v2/articles"><span className="v2-nav__label">{japanese ? "記事一覧" : "All articles"}</span></Link></li></ul>}
      aside={<V2Aside title={japanese ? "並べて見る" : "Alongside"} posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={shell.currentProfile.id} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "シリーズの管理" : "Manage series"} />
      <V2SeriesManager key={viewerId ?? "guest"} authenticated={Boolean(viewerId)} japanese={japanese} />
    </V2Shell>
  );
}
