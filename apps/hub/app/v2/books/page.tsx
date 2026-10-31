import type { Metadata } from "next";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2BookDiscovery } from "@/components/v2/v2-book-discovery";
import { V2Shell } from "@/components/v2/v2-shell";
import { getHubBooks } from "@/lib/books/library";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "本 | Hub v2" };

/*
 * 本の一覧。既存の /books から機能だけを抜いた: 表紙・題・著者・配布元・章数か巻数・
 * 読み方（横書きの記事か固定レイアウト）・最初から読む。読む画面は既存の
 * /books/[id]/[章か巻]（本文の分割と出典の仕組みを持つ）へ渡す。
 */
export default async function V2BooksPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const HUB_BOOKS = await getHubBooks();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  return (
    <V2Shell
      currentPath="/v2/books"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "本" : "Books"} action={<span className="v2-heading__note">{japanese ? `${HUB_BOOKS.length}冊 · 無料公開` : `${HUB_BOOKS.length} books, free`}</span>} />
      <p className="v2-note">{japanese ? "本は横書きの記事として読めます。漫画などは固定レイアウトです。" : "Books read as horizontal articles; comics use a fixed layout."}</p>
      <V2BookDiscovery books={HUB_BOOKS} locale={locale} />
    </V2Shell>
  );
}
