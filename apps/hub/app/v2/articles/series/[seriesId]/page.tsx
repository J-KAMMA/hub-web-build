import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getPublicSeries } from "@/lib/server/d1-user-article-series";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../v2.css";
import "../../../v2-article-series.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

async function load(seriesId: string) {
  const database = getOptionalHubD1();
  if (!database) return null;
  return getPublicSeries(database, seriesId).catch(() => null);
}

export async function generateMetadata({ params }: { params: Promise<{ seriesId: string }> }): Promise<Metadata> {
  const series = await load((await params).seriesId);
  if (!series) return { title: "シリーズが見つかりません | Hub v2", robots: { index: false } };
  return {
    title: `${series.title} | シリーズ | Hub v2`,
    description: series.description || undefined,
    alternates: { canonical: `/v2/articles/series/${series.id}` },
  };
}

/*
 * 著者1人のシリーズ。著者が決めた順に、公開中の一般記事の題だけを並べる。
 * 本文・要約は読まない（条件付きの記事も題だけ。本文は記事の画面で条件を満たした人に開く）。
 */
export default async function V2SeriesPage({ params }: { params: Promise<{ seriesId: string }> }) {
  const { seriesId } = await params;
  const [locale, shell, series] = await Promise.all([getHubLocale(), getAppShellData(), load(seriesId)]);
  if (!series) notFound();
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
      <V2ColumnHead heading title={japanese ? "シリーズ" : "Series"} />
      <div className="v2-series-page">
        <h1>{series.title}</h1>
        <p>
          {series.ownerHandle ? <Link href={`/v2/profile/${series.ownerHandle}`}>{series.ownerName}</Link> : series.ownerName}
          {viewerId && viewerId === series.ownerProfileId ? <> ・ <Link href="/v2/articles/series">{japanese ? "管理する" : "Manage"}</Link></> : null}
        </p>
        {series.description ? <p className="v2-series-page__desc">{series.description}</p> : null}
        {series.articles.length ? (
          <ol className="v2-series-list">
            {series.articles.map((article) => (
              <li key={article.id}>
                <Link href={`/v2/articles/${article.id}`}><strong>{article.title}</strong></Link>
              </li>
            ))}
          </ol>
        ) : <p className="v2-series-page__desc">{japanese ? "公開中の記事はまだありません。" : "No published articles yet."}</p>}
      </div>
    </V2Shell>
  );
}
