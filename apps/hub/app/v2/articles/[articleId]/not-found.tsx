import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-article.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

/* 記事が無いときも v2 の枠の中で出す（旧シェルの404へ落とさない）。 */
export default async function V2ArticleNotFound() {
  const japanese = (await getHubLocale()) === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: "/v2/articles", label: japanese ? "記事一覧へ" : "All articles" }} japanese={japanese} />}
      currentPath="/v2/articles"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead title={japanese ? "記事" : "Article"} />
      <div className="v2-reader-missing">
        <h1>{japanese ? "記事が見つかりません" : "Article not found"}</h1>
        <p>{japanese
          ? "この記事は存在しないか、取り下げられた可能性があります。URLを確かめるか、一覧から探してください。"
          : "This article does not exist or may have been withdrawn. Check the URL or browse the list."}</p>
        <p><Link href="/v2/articles">{japanese ? "記事一覧へ戻る" : "Back to all articles"}</Link></p>
      </div>
    </V2Shell>
  );
}
