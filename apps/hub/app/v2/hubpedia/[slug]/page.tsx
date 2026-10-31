import type { Metadata } from "next";
import { V2HubpediaKnowledgeSummary } from "@/components/v2/v2-hubpedia-knowledge-summary";
import { ResearchDiscovery } from '@/components/research-discovery';
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { KnowledgeEvidencePanel, KnowledgeStateCard } from "@/components/encyclopedia/knowledge-state-card";
import { SourceDisclosure } from "@/components/encyclopedia/source-disclosure";
import { SpoilerAwareArticle, type ArticleSpoilerScope } from "@/components/encyclopedia/spoiler-aware-article";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2ContentLicense } from "@/components/v2/v2-content-license";
import { HUBPEDIA_ARTICLE_LICENSE } from "@/lib/content-license";
import { canonicalHubpediaSlug } from "@/lib/encyclopedia/article-aliases";
import { estimateArticleReadingMinutes, getArticleOutline } from "@/lib/encyclopedia/article-outline";
import { HubpediaAnnotatedBody } from "@/components/v2/hubpedia-annotations";
import { HubpediaAuthorshipHeader } from "@/components/v2/hubpedia-authorship";
import { listArticleStructure } from "@/lib/server/hubpedia-wiki-annotations";
import { getWikiArticle, getWikiRevisionKey } from "@/lib/server/hubpedia-wiki";
import { isHumanEditingEnabled } from "@/lib/server/hubpedia-wiki-policy";
import { getRelatedSeedArticlesWithReasons } from "@/lib/encyclopedia/article-relations";
import { removeEmbeddedRelatedSection, removeEmbeddedSourceSection } from "@/lib/encyclopedia/article-structure";
import { getPublicReaderReadySeedArticles, getPublicSeedArticle } from "@/lib/encyclopedia/public-seed";
import { getPublishedArticleBySlug, listPublishedArticleLinkTargets } from "@/lib/encyclopedia/repository";
import { deriveArticleKeyPoints } from "@/lib/encyclopedia/knowledge-summary";
import { keepCommerciallyReusableSources } from "@/lib/encyclopedia/source-license-policy";
import { removeRepeatedTitleFromSummary } from "@/lib/encyclopedia/summary-display";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubD1, getOptionalHubD1, getOptionalHubLedgerObjects } from "@/lib/server/hub-d1";
import { renderLedgerRevision } from "@/lib/encyclopedia/ledger/render";
import { HubpediaWikipediaAttribution } from "@/components/v2/hubpedia-wikipedia-attribution";
import { lookupWikipediaBase } from "@/lib/encyclopedia/wikipedia/read";
import { getHubpediaIndexability } from "@/lib/server/hubpedia-search-exposure";
import { emptyHubpediaArticleKnowledge, getHubpediaArticleKnowledge, hubpediaArticleType } from "@/lib/server/hubpedia-research-knowledge";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../hubpedia-wiki.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const canonical = canonicalHubpediaSlug(slug);
  const seed = await getPublicSeedArticle(canonical);
  // Search engines see only human-reviewed entries (DESIGN.md section 7); fails closed.
  const exposure = await getHubpediaIndexability(getOptionalHubD1(), canonical, Boolean(seed), Boolean(seed?.aiGenerated));
  /* A Japanese Wikipedia base article is always noindex (2026-10-30), whatever the exposure rule says. */
  let baseTitle: string | null = null;
  if (!seed) {
    try {
      const db = getOptionalHubD1();
      const base = db ? await lookupWikipediaBase(db, getOptionalHubLedgerObjects(), slug) : null;
      if (base?.kind === "article") baseTitle = base.article.title;
    } catch {
      baseTitle = null;
    }
  }
  return {
    title: `${seed?.title ?? baseTitle ?? "Hubpedia"} | Hubpedia | Hub v2`,
    ...(exposure.index && baseTitle === null ? {} : { robots: { index: false, follow: true } }),
  };
}

/*
 * v2 の Hubpedia 記事。既存の /hubpedia/[slug] から機能だけを抜いた:
 * 別名の正規化、公開記事（D1）→ 種の順で本文を選ぶ、言語（?lang=）、要約、読了時間、
 * 目次、本文（記事内リンクは公開済みの記事へ）、出典（商用可のもの）、関連項目、
 * 要点・知識の状態・ネタバレの段階（2026-09-05 に足した）。
 *
 * ワークベンチ（記事の提案）と広告は既存の画面のまま。
 */
export default async function V2HubpediaArticlePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const [{ slug }, { lang }, locale, shell] = await Promise.all([params, searchParams, getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const canonical = canonicalHubpediaSlug(slug);
  if (canonical !== slug) redirect(`/v2/hubpedia/${canonical}${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`);
  const requestedLocale = lang ?? locale;
  if (!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/.test(requestedLocale)) notFound();

  const [seed, PUBLIC_READER_READY_SEED_ARTICLES] = await Promise.all([getPublicSeedArticle(slug), getPublicReaderReadySeedArticles()]);
  const seedTranslation = requestedLocale === "ja" ? undefined : seed?.translations?.[requestedLocale];
  let published: Awaited<ReturnType<typeof getPublishedArticleBySlug>> = null;
  let linkTargets: Awaited<ReturnType<typeof listPublishedArticleLinkTargets>> = [];
  try {
    [published, linkTargets] = await Promise.all([getPublishedArticleBySlug(slug, requestedLocale), listPublishedArticleLinkTargets()]);
  } catch (error) {
    if (!seed && process.env.CLOUDFLARE_RUNTIME === "workers") throw error;
  }
  /* The Japanese Wikipedia base layer: only when no Hub article (published revision or seed) exists for the slug. */
  let wikipediaBase: Awaited<ReturnType<typeof lookupWikipediaBase>> = null;
  if (!published && !seed) {
    try {
      wikipediaBase = await lookupWikipediaBase(getHubD1(), getOptionalHubLedgerObjects(), slug);
    } catch {
      wikipediaBase = null;
    }
    if (wikipediaBase?.kind === "redirect") redirect(`/v2/hubpedia/${encodeURIComponent(wikipediaBase.slug)}`);
  }
  const wikipedia = wikipediaBase?.kind === "article" ? wikipediaBase.article : null;
  const article = published ?? (wikipedia ? {
    title: wikipedia.title,
    summary: wikipedia.summary,
    bodyMarkdown: wikipedia.bodyMarkdown,
    locale: "ja",
    availableLocales: ["ja"],
  } : null) ?? (seed ? {
    title: seedTranslation?.title ?? seed.title,
    summary: seedTranslation?.summary ?? seed.summary,
    bodyMarkdown: seedTranslation?.bodyMarkdown ?? seed.bodyMarkdown,
    locale: seedTranslation ? requestedLocale : "ja",
    availableLocales: ["ja", ...Object.keys(seed.translations ?? {})],
  } : null);
  if (!article) notFound();

  /* Ledger bodies carry {c:ref} markers: render only sentences that still verify, or no body at all. */
  const ledger = published && article.bodyMarkdown.includes("{c:") ? await renderLedgerRevision(getHubD1(), published.revisionId, article.bodyMarkdown, getOptionalHubLedgerObjects()) : null;
  if (published && article.bodyMarkdown.includes("{c:") && !ledger) notFound();
  const body = removeEmbeddedSourceSection(removeEmbeddedRelatedSection(ledger?.bodyMarkdown ?? article.bodyMarkdown));
  const outline = getArticleOutline(body);
  const minutes = estimateArticleReadingMinutes(body, article.locale);
  const sources = ledger?.sources ?? published?.sources ?? keepCommerciallyReusableSources(seed?.sources ?? []);
  const related = seed ? getRelatedSeedArticlesWithReasons(seed, PUBLIC_READER_READY_SEED_ARTICLES) : [];
  const lower = `${article.title}\n${body}`.toLocaleLowerCase(article.locale);
  const articleLinks = [
    ...PUBLIC_READER_READY_SEED_ARTICLES.map((candidate) => ({ slug: candidate.slug, title: candidate.translations?.[article.locale]?.title ?? candidate.title })),
    ...linkTargets.map((target) => ({ slug: target.slug, title: target.title })),
  ].filter((candidate) => candidate.slug !== slug && candidate.title.length >= 2 && lower.includes(candidate.title.toLocaleLowerCase(article.locale))).slice(0, 60);
  /*
   * 要点・知識の状態・ネタバレの段階（2026-09-05、旦那様の「全部を v2 に」）。
   * ここまで既存の記事画面へ渡していた3つ。部品は既存と同じものを使う。
   *
   * どれも**無くても記事は読める**——知識の表も段階の表も、移行の途中では
   * まだ無いことがある。落ちたら空のまま進む（既存も同じ扱い）。
   */
  const inferredArticleType = hubpediaArticleType(published?.topicType ?? seed?.topicType);
  let knowledge = emptyHubpediaArticleKnowledge(inferredArticleType);
  try {
    knowledge = await getHubpediaArticleKnowledge(getHubD1(), slug);
    if (knowledge.articleType === "general") knowledge.articleType = inferredArticleType;
  } catch {
    // 知識の移行が当たっていない間も記事は読める。
  }
  const keyPoints = deriveArticleKeyPoints(body, knowledge.claims);
  let spoilerScopes: ArticleSpoilerScope[] = [];
  try {
    const rows = await getHubD1().prepare(
      `SELECT section_key sectionKey,work_slug workSlug,earliest_installment earliestInstallment,
        original_release_at originalReleaseAt,disclosure_level disclosureLevel,summary
       FROM hubpedia_article_spoiler_scopes WHERE article_slug=? ORDER BY section_key`,
    ).bind(slug).all<ArticleSpoilerScope>();
    spoilerScopes = rows.results ?? [];
  } catch {
    // 段階の表が無い間は、本文をそのまま出す（SpoilerAwareArticle が畳まない）。
  }

  /* 段落ごとの根拠と議論（人と AI の共同編集）。無くても記事は読める。 */
  let structure: Awaited<ReturnType<typeof listArticleStructure>> | null = null;
  let wikiAuthorKind = "ai";
  let contributorCount = 0;
  let baseRevisionKey = "seed";
  try {
    const database = getHubD1();
    const [wiki, revisionKey] = await Promise.all([getWikiArticle(database, slug), getWikiRevisionKey(database, slug)]);
    baseRevisionKey = revisionKey;
    if (wiki) {
      wikiAuthorKind = wiki.authorKind;
      try {
        const parsed = JSON.parse(wiki.contributorsJson ?? "[]");
        contributorCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        contributorCount = 0;
      }
    }
    structure = await listArticleStructure(database, slug);
  } catch {
    structure = null;
  }
  const humanEditingEnabled = isHumanEditingEnabled();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const locales = article.availableLocales ?? ["ja"];

  /* 言語の切り替えは題の右の小さな切替（左列の項目にしない）。 */
  const languageSwitch = locales.length > 1 ? (
    <nav className="v2-lang" aria-label={japanese ? "言語" : "Language"}>
      {locales.map((code) => (
        <Link key={code} className="v2-lang__item" href={code === "ja" ? `/v2/hubpedia/${slug}` : `/v2/hubpedia/${slug}?lang=${encodeURIComponent(code)}`} aria-current={code === article.locale ? "page" : undefined}>{code.toUpperCase()}</Link>
      ))}
    </nav>
  ) : null;

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: "/v2/hubpedia", label: japanese ? "一覧へ" : "All articles" }} japanese={japanese} />}
      currentPath={`/v2/hubpedia/${slug}`}
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} initialView="search" title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead title={article.title} action={languageSwitch} />
      <article className="v2-article">
        <h1 className="v2-hartitle ui-title-wrap">{article.title}</h1>
        {article.summary ? <p className="v2-article__summary">{removeRepeatedTitleFromSummary(article.title, article.summary)}</p> : null}
        <p className="v2-article__byline">
          <span>{japanese ? `約${minutes}分で読めます` : `About ${minutes} min`}</span>
          <span>{japanese ? `${outline.length}節` : `${outline.length} sections`}</span>
          <span>{article.locale.toUpperCase()}</span>
          {published ? <span>{japanese ? "公開記事" : "Published"}</span> : null}
        </p>
        {outline.length ? (
          <nav className="v2-toc" aria-label={japanese ? "目次" : "Contents"}>
            <ol className="v2-toc__list">
              {outline.map((item) => (
                <li key={item.id} className={item.level === 3 ? "v2-toc__item v2-toc__item--sub" : "v2-toc__item"}><a href={`#${item.id}`}>{item.title}</a></li>
              ))}
            </ol>
          </nav>
        ) : null}
        <nav className="hubpedia-wiki__subnav" aria-label="記事の履歴と変更">
          <Link href={`/v2/hubpedia/${encodeURIComponent(slug)}/history`}>履歴</Link>
          <Link href="/v2/hubpedia/recent-changes">最近の変更</Link>
        </nav>
        {wikipedia ? <HubpediaWikipediaAttribution article={wikipedia} japanese={japanese} /> : (
          <>
            <HubpediaAuthorshipHeader
              authorKind={wikiAuthorKind}
              aiRatio={knowledge.aiGeneratedRatio}
              humanReviewScope={knowledge.humanReviewScope}
              contributorCount={contributorCount}
            />
            <V2HubpediaKnowledgeSummary knowledge={knowledge} japanese={japanese}>
              <KnowledgeStateCard knowledge={knowledge} articleUpdatedAt={published?.revisionCreatedAt ?? null} />
            </V2HubpediaKnowledgeSummary>
          </>
        )}
        {keyPoints.length ? (
          <section className="hubpedia-key-points" aria-labelledby="v2-hubpedia-key-points">
            <h2 id="v2-hubpedia-key-points">{japanese ? "要点" : "Key points"}</h2>
            <ul>{keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
          </section>
        ) : null}
        <div className="v2-article__body v2-hubpedia__body">
          {/*
            * ネタバレの段階（2026-09-05）。段階の表が無ければ、この部品は
            * ArticleMarkdown をそのまま呼ぶので、今までと同じ本文が出る。
            *
            * 広告（既存は本文の途中に1つ挟む）は渡していない。v2 の読み物には
            * まだどこにも広告が無く、ここだけ出すのは見た目の意図の話なので、
            * 勝手に決めない。
            */}
          <SpoilerAwareArticle
            markdown={body}
            locale={article.locale}
            articleLinks={articleLinks}
            scopes={spoilerScopes}
          />
        </div>
        {structure && structure.paragraphs.length ? (
          <HubpediaAnnotatedBody
            slug={slug}
            paragraphs={structure.paragraphs}
            claims={structure.claims}
            authorKind={wikiAuthorKind}
            signedIn={Boolean(shell.currentProfile.id)}
            humanEditingEnabled={humanEditingEnabled}
            baseRevisionKey={baseRevisionKey}
          />
        ) : null}
        <KnowledgeEvidencePanel knowledge={knowledge} surface="/v2" />
        {sources.length ? (
          <section className="v2-msec" aria-labelledby="v2-hubpedia-sources">
            <header className="v2-msec__head"><h2 id="v2-hubpedia-sources" className="v2-column__title v2-column__title--section">{japanese ? "出典" : "Sources"}</h2><span className="v2-msec__note">{sources.length}</span></header>
            {/*
              * 出典の状態（2026-09-05）。もとは題名と発行元だけを並べていた。
              * 既存が使っている部品は、そこに確認の段階と再利用の条件を添える。
              * 「出典の状態」を見に既存へ渡していたので、その中身をここへ置く。
              */}
            <SourceDisclosure sources={sources} />
          </section>
        ) : null}
        {related.length ? (
          <section className="v2-msec" aria-labelledby="v2-hubpedia-related">
            <header className="v2-msec__head"><h2 id="v2-hubpedia-related" className="v2-column__title v2-column__title--section">{japanese ? "関連項目" : "Related"}</h2></header>
            <ul className="v2-tlist">
              {related.map(({ article: candidate, reason }) => (
                <li key={candidate.slug} className="v2-tcard">
                  <Link className="v2-tcard__title" href={`/v2/hubpedia/${encodeURIComponent(candidate.slug)}`}>{candidate.translations?.[article.locale]?.title ?? candidate.title}</Link>
                  {reason ? <p className="v2-tcard__excerpt">{reason}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {/* 本文のライセンスは Hubpedia 全体で CC BY-SA 4.0 に決めている（利用者は選ばない）。 */}
        <V2ContentLicense license={HUBPEDIA_ARTICLE_LICENSE} japanese={japanese} />
        <ResearchDiscovery kind="hubpedia" targetId={slug}/>
      </article>
    </V2Shell>
  );
}
