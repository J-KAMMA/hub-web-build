import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2MagazineAuthorRemove } from "@/components/v2/v2-magazine-author-remove";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getPublicMagazine } from "@/lib/server/d1-user-article-magazines";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../v2.css";
import "../../../v2-article-magazines.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

async function load(magazineId: string) {
  const database = getOptionalHubD1();
  if (!database) return null;
  return getPublicMagazine(database, magazineId).catch(() => null);
}

export async function generateMetadata({ params }: { params: Promise<{ magazineId: string }> }): Promise<Metadata> {
  const magazine = await load((await params).magazineId);
  if (!magazine) return { title: "マガジンが見つかりません | Hub v2", robots: { index: false } };
  return {
    title: `${magazine.title} | マガジン | Hub v2`,
    description: magazine.description || undefined,
    alternates: { canonical: `/v2/articles/magazines/${magazine.id}` },
  };
}

/*
 * 集めた人（キュレーター）のマガジン。書き手を問わず、公開中の一般記事の題だけを並べる。
 * 本文・要約は読まない（条件付きの記事も題だけ。本文は記事の画面で条件を満たした人に開く）。
 * 記事の書き手本人には「このマガジンから外す」を出す。
 */
export default async function V2MagazinePage({ params }: { params: Promise<{ magazineId: string }> }) {
  const { magazineId } = await params;
  const [locale, shell, magazine] = await Promise.all([getHubLocale(), getAppShellData(), load(magazineId)]);
  if (!magazine) notFound();
  const japanese = locale === "ja";
  const viewerId = shell.currentProfile.id || null;
  return (
    <V2Shell skin="luxe"
      currentPath="/v2/articles"
      profile={shell.currentProfile}
      items={v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount })}
      directoryTitle={japanese ? "記事" : "Articles"}
      directory={<Link className="v2-nav__item" href="/v2/articles">{japanese ? "記事一覧" : "All articles"}</Link>}
      aside={<V2Aside title={japanese ? "並べて見る" : "Alongside"} posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={shell.currentProfile.id} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "マガジン" : "Magazine"} />
      <div className="v2-magazine-page">
        <h1>{magazine.title}</h1>
        <p className="v2-magazine-page__desc">
          {japanese ? "集めた人：" : "Curated by "}
          {magazine.ownerHandle ? <Link href={`/v2/profile/${magazine.ownerHandle}`}>{magazine.ownerName}</Link> : magazine.ownerName}
          {viewerId && viewerId === magazine.ownerProfileId ? <> ・ <Link href="/v2/articles/magazines">{japanese ? "管理する" : "Manage"}</Link></> : null}
        </p>
        {magazine.description ? <p className="v2-magazine-page__desc">{magazine.description}</p> : null}
        {magazine.articles.length ? (
          <ol className="v2-magazine-list">
            {magazine.articles.map((article) => (
              <li key={article.id}>
                <Link href={`/v2/articles/${article.id}`}><strong>{article.title}</strong></Link>
                <span className="v2-magazine-list__meta">
                  {article.authorHandle ? <Link href={`/v2/profile/${article.authorHandle}`}>{article.authorName}</Link> : <span>{article.authorName}</span>}
                  {article.gated ? <span className="v2-magazine-list__tag">{japanese ? "条件付き" : "Gated"}</span> : null}
                  {viewerId && viewerId === article.authorProfileId && viewerId !== magazine.ownerProfileId
                    ? <V2MagazineAuthorRemove magazineId={magazine.id} articleId={article.id} japanese={japanese} />
                    : null}
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="v2-magazine-page__desc">{japanese ? "公開中の記事はまだありません。" : "No published articles yet."}</p>}
      </div>
    </V2Shell>
  );
}
