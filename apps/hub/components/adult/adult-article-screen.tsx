import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdultPageShell } from "@/components/adult/adult-page-shell";
import { ArticleBodyView } from "@/components/article-body-view";
import type { HubUiSurface } from "@/lib/hub-surface-path";
import { findUserArticle } from "@/lib/server/d1-user-articles";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

/*
 * 利用者が書いた成人向け記事の閲覧画面。
 *
 * 成人向けの作品紹介（アフィリエイトのカタログ）は 2026-10-15 にHubから外した。
 * ここに残るのは、記事の年齢区分（audience = adult）と、本人が有効にする
 * 成人表示の設定だけ。本文は誰に対しても描き、確認していない人には上から重ねる。
 */
export const adultArticleMetadata: Metadata = {
  title: "成人向け記事",
  openGraph: { title: "成人向け記事", images: [] },
};

export async function AdultArticleScreen({
  params,
  surface = "",
}: {
  params: Promise<{ slug: string }>;
  surface?: HubUiSurface;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const currentPath = `${surface}/adult/articles/${encodeURIComponent(slug)}`;

  const database = getOptionalHubD1();
  const written = database ? await findUserArticle(database, slug, { audience: "adult" }) : null;
  if (!written) notFound();

  return (
    <AdultPageShell surface={surface} currentPath={currentPath} ownsHeading={false}>
      <article className="hub-article-page">
        <p className="hub-article-page__kicker">
          <span>成人向け記事</span>
          <span>18歳未満の方の閲覧をお断りしています</span>
        </p>
        <h1>{written.title}</h1>
        <p className="hub-article-page__byline">
          <span>{written.authorName}</span>
          {written.authorHandle ? <small>@{written.authorHandle}</small> : null}
        </p>
        {written.summary ? <p className="hub-article-page__summary">{written.summary}</p> : null}
        {written.tags.length ? (
          <ul className="hub-article-page__tags">
            {written.tags.map((tag) => <li key={tag}>{tag}</li>)}
          </ul>
        ) : null}
        <ArticleBodyView body={written.body} className="hub-article-page__body" />
      </article>
    </AdultPageShell>
  );
}
