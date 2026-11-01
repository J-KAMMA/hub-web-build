import type { Metadata } from "next";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "./v2.css";

export const dynamic = "force-dynamic";

/* 見つからない応答は noindex だけを出す。ルートの index, follow と並べて出さない。 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/*
 * /v2 配下で notFound() が呼ばれたときの画面。旧い外郭（白い左列・「ポストする」）へ落とさず、
 * v2 の枠の中に V2State を出す。個別の not-found.tsx を持つ経路（記事など）はそちらが優先される。
 */
export default async function V2NotFound() {
  const japanese = (await getHubLocale()) === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  return (
    <V2Shell
      currentPath="/v2"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "ページ" : "Page"} />
      <V2State
        kind="empty"
        icon="search"
        title={japanese ? "ページが見つかりません" : "Page not found"}
        note={japanese ? "URLが違うか、ページが移動または削除された可能性があります。" : "The URL may be wrong, or the page may have moved or been removed."}
        action={{ label: japanese ? "ホームへ" : "Home", href: "/v2" }}
        secondaryAction={{ label: japanese ? "検索" : "Search", href: "/v2/search" }}
      />
    </V2Shell>
  );
}
