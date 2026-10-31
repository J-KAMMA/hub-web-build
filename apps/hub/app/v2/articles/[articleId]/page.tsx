import type { Metadata } from "next";
import { ResearchDiscovery } from '@/components/research-discovery';
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleBodyView } from "@/components/article-body-view";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ArticleReader } from "@/components/v2/v2-article-reader";
import { V2ArticleEngagement } from "@/components/v2/v2-article-engagement";
import { V2ArticleSave } from "@/components/v2/v2-article-save";
import { V2ArticleTip } from "@/components/v2/v2-article-tip";
import { V2ArticleSeriesBox } from "@/components/v2/v2-article-series-box";
import { V2ArticleMagazineAdd } from "@/components/v2/v2-article-magazine-add";
import { V2ArticleViewBeacon } from "@/components/v2/v2-article-view-beacon";
import { V2ContentShare } from '@/components/v2/v2-content-share';
import { V2ArticleQuote } from '@/components/v2/v2-article-quote-gate';
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2HubpediaCitations } from "@/components/v2/v2-hubpedia-citations";
import { V2DetailSection } from "@/components/v2/v2-detail";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { articleHeadingList } from "@/lib/article-body";
import { readingMinutes } from "@/lib/article-reading";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { loadArticleAuthorCard, loadArticleNeighbours } from "@/lib/server/article-reader-data";
import { loadArticleEngagement } from "@/lib/server/d1-user-article-engagement";
import { findUserArticle, listUserArticles } from "@/lib/server/d1-user-articles";
import { isUserArticleSaved } from "@/lib/server/d1-user-article-saves";
import { getArticleSeriesContext } from "@/lib/server/d1-user-article-series";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { isHubItemGated, metadataDescription } from "@/lib/server/gated-exits";
import { loadHubItemCitations } from "@/lib/server/hubpedia-citations";
import { getHubLocale } from "@/lib/server/locale";
import { memberArticleContent } from "@/lib/v2-articles";
import { v2NavItems } from "@/lib/v2-nav";
import { relativeTime } from "@/lib/v2-time";

import "../../v2.css";
import "../../v2-article.css";
import "../../v2-article-series.css";
import { V2GatedLockedCard } from "@/components/v2/v2-gated-locked-card";
import { V2ArticlePreface } from "@/components/v2/v2-article-preface";
import { V2ContentFiles } from "@/components/v2/v2-content-files";
import { V2ContentLicense } from "@/components/v2/v2-content-license";
import { getContentLicense } from "@/lib/server/content-licenses";
import "../../redesign-media.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

async function loadArticle(articleId: string, viewerProfileId: string | null = null) {
  const database = getOptionalHubD1();
  if (!database) return null;
  /* 一般側の道では一般の記事しか返さない。成人向けは /adult 側だけ。既存と同じ。 */
  return findUserArticle(database, articleId, { audience: "general", viewerProfileId });
}

export async function generateMetadata({ params }: { params: Promise<{ articleId: string }> }): Promise<Metadata> {
  const { articleId } = await params;
  const article = await loadArticle(articleId);
  if (!article) return { title: "記事が見つかりません | Hub v2", robots: { index: false } };
  const database = getOptionalHubD1();
  /* 条件付きの記事は題だけ。要約は本文から作られうるので、判定できなければ出さない（gated-exits）。 */
  const gated = Boolean(article.accessGate);
  const description = gated ? undefined : await metadataDescription(database ?? undefined, "article", articleId, article.summary);
  const cover = !gated && article.thumbnailUrl ? article.thumbnailUrl : null;
  const title = `${article.title} | 記事 | Hub v2`;
  const canonical = `/v2/articles/${article.id}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: article.title,
      description,
      url: canonical,
      siteName: "Hub",
      publishedTime: article.createdAt,
      modifiedTime: article.updatedAt,
      ...(cover ? { images: [{ url: cover }] } : {}),
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title: article.title,
      description,
      ...(cover ? { images: [cover] } : {}),
    },
  };
}

/*
 * v2 の記事詳細（Hubの書き手の記事）。既存の /articles/[id] には触れない。
 * Hubpedia の記事と Vault の記事は、それぞれ既存の画面のまま（一覧から既存へ飛ぶ）。
 * 読む画面の枠は components/v2/v2-article-reader.tsx。本文の描画は ArticleBodyView を共有する。
 * 条件付きの記事は V2GatedLockedCard を出し、本文・読了時間・目次は作らない。
 */
export default async function V2ArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  // Token gates need the viewer, so the article is read after the shell.
  const shell = await getAppShellData();
  const viewerId = shell.currentProfile.id || null;
  const article = await loadArticle(articleId, viewerId);
  if (!article) notFound();
  const locked = Boolean(article.accessGate);
  const database = getOptionalHubD1();
  // The author and holders read the body, but the page still says it is gated. Display only; access is decided above.
  const gated = locked || (database ? await isHubItemGated(database, "article", article.id).catch(() => false) : false);
  const [citations, author, neighbours, others, saved, engagement, seriesContext] = await Promise.all([
    loadHubItemCitations("article", article.id),
    database ? loadArticleAuthorCard(database, article.authorProfileId, viewerId) : Promise.resolve(null),
    database ? loadArticleNeighbours(database, article) : Promise.resolve({ previous: null, next: null }),
    /* 同じタグの記事。一般の記事24本の中から、タグが1つでも重なるものを6本まで。 */
    database ? listUserArticles(database, { audience: "general", limit: 24 }).catch(() => []) : Promise.resolve([]),
    /* 保存済みかはここで読む。ボタンが取得待ちの灰色のまま残らないように。 */
    database && viewerId ? isUserArticleSaved(database, viewerId, article.id).catch(() => undefined) : Promise.resolve(undefined),
    /* 鍵付きの記事は、条件を満たして本文が開くまでいいね・コメント欄を出さない。 */
    database && !locked ? loadArticleEngagement(database, article.id, article.authorProfileId, viewerId).catch(() => null) : Promise.resolve(null),
    /* 著者が束ねたシリーズ。題と前後の記事の題だけ。表が無い・失敗しても記事は出す。 */
    database ? getArticleSeriesContext(database, article.id).catch(() => null) : Promise.resolve(null),
  ]);
  const license = database ? await getContentLicense(database, { targetType: "article", targetId: article.id }).catch(() => "arr" as const) : "arr" as const;
  const headings = locked ? [] : articleHeadingList(article.body);
  const minutes = locked ? 0 : readingMinutes(article.body);
  const related = others
    .filter((item) => item.id !== article.id && item.tags.some((tag) => article.tags.includes(tag)))
    .slice(0, 6)
    .map(memberArticleContent);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const publishedAt = new Date(article.createdAt);
  const publishedLabel = Number.isNaN(publishedAt.getTime())
    ? null
    : publishedAt.toLocaleDateString(japanese ? "ja-JP" : "en-US", { year: "numeric", month: "long", day: "numeric" });
  const updatedLabel = article.updatedAt !== article.createdAt
    ? (japanese ? `更新 ${relativeTime(article.updatedAt, locale)}` : `updated ${relativeTime(article.updatedAt, locale)}`)
    : null;

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: "/v2/articles", label: japanese ? "記事一覧へ" : "All articles" }} japanese={japanese} />}
      currentPath="/v2/articles"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead title={japanese ? "記事" : "Article"} action={<span className="v2-heading__note">{gated ? (japanese ? "鍵つき" : "Token-gated") : japanese ? "無料記事" : "Free article"}</span>} />

      <V2ArticleViewBeacon articleId={article.id} />
      <V2ArticleReader
        title={article.title}
        summary={locked ? undefined : article.summary}
        coverUrl={article.thumbnailUrl}
        authorName={article.authorName}
        authorHandle={article.authorHandle}
        authorAvatarUrl={author?.avatarUrl ?? null}
        publishedAt={article.createdAt}
        publishedLabel={publishedLabel}
        updatedLabel={updatedLabel}
        minutes={minutes}
        tags={article.tags.map((tag) => ({ label: tag, href: `/v2/articles?tag=${encodeURIComponent(tag)}` }))}
        headings={headings}
        actions={<><V2ArticleSave key={article.id} articleId={article.id} authenticated={Boolean(viewerId)} initialSaved={saved} japanese={japanese}/><V2ContentShare href={`/v2/articles/${article.id}`} japanese={japanese}/></>}
        author={author}
        viewerId={viewerId}
        neighbours={{
          previous: neighbours.previous ? { id: neighbours.previous.id, title: neighbours.previous.title } : null,
          next: neighbours.next ? { id: neighbours.next.id, title: neighbours.next.title } : null,
        }}
        japanese={japanese}
        footer={
          <>
            {locked ? null : <V2ContentLicense license={license} authorName={article.authorName} japanese={japanese} />}
            <V2ArticleTip articleId={article.id} authorHandle={article.authorHandle} authorProfileId={article.authorProfileId} viewerId={viewerId} japanese={japanese} />
            {engagement ? <V2ArticleEngagement articleId={article.id} initial={engagement} authenticated={Boolean(viewerId)} locale={locale} /> : null}
            <V2HubpediaCitations citations={citations} japanese={japanese} />
            {related.length ? (
              <V2DetailSection title={japanese ? "同じタグの記事" : "Related articles"} note={japanese ? `${related.length}本` : `${related.length}`}>
                <ul className="v2-agrid">
                  {related.map((item) => (
                    <li key={item.contentId}>
                      <Link className="v2-acard" href={item.href}>
                        <span className="v2-acard__art">
                          {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" width={296} height={222} loading="lazy" decoding="async" /> : <span className="v2-acard__cover" aria-hidden="true">{item.tags?.[0] ?? (japanese ? "記事" : "Article")}</span>}
                        </span>
                        <strong className="v2-acard__title">{item.title}</strong>
                        <small className="v2-acard__meta"><span>{item.author}</span></small>
                      </Link>
                    </li>
                  ))}
                </ul>
              </V2DetailSection>
            ) : null}
          </>
        }
      >
        {/* 書き手が誰にでも見せると決めた部分。本文から作らない。鍵が付く記事では、鍵の線のあとに本文（または鍵つきカード）が続く。 */}
        <V2ArticlePreface preface={article.publicPreface ?? ""} gated={gated} />
        {article.accessGate
          ? <V2GatedLockedCard gate={article.accessGate.gate} status={article.accessGate.status} title={article.title} hideTitle targetType="article" targetId={article.id} />
          : <ArticleBodyView body={article.body} className="v2-prose v2-reader__body" />}
        <V2ContentFiles targetType="article" targetId={article.id} canManage={Boolean(viewerId) && article.authorProfileId === viewerId} japanese={japanese} />
        {seriesContext ? <V2ArticleSeriesBox series={seriesContext} japanese={japanese} /> : null}
        <V2ArticleMagazineAdd articleId={article.id} authenticated={Boolean(viewerId)} japanese={japanese} />
        <V2ArticleQuote articleId={article.id} viewerId={viewerId} locked={locked} japanese={japanese} />
        <ResearchDiscovery kind="article" targetId={article.id}/>
      </V2ArticleReader>
    </V2Shell>
  );
}
