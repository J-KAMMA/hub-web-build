"use client";

import Link from "next/link";
import { V2DiscoveryOptions, V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";

import { V2Empty } from "@/components/v2/v2-empty";
import { V2GateBadge } from "@/components/v2/v2-gate-badge";
import { MediaFrame } from "@/components/v2/ui";
import { useCallback, useMemo } from "react";

import { articleBadges, type HubArticleContent } from "@/lib/article-content";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";
import { matchesArticle, matchesArticleKind, type V2ArticleAccess, type V2ArticleKind } from "@/lib/v2-article-filters";
import type { ArticleCardExtras } from "@/lib/v2-article-card-extras";
import { rankDiscoveryItems } from "@/lib/discovery-recommendations";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { V2TagChipRow } from "./v2-tag-chip";

import "../../app/v2/v2-article-list.css";

/*
 * 記事の一覧。既存の unified-article-directory.tsx から機能だけを抜いた。
 *
 * 2系統を結合する: Hubの書き手の記事（サーバーで絞り・ページ送りして渡す）と、
 * Hubpedia の無料記事（静的、サーバーで渡す）。
 *
 * Hubの書き手の記事は、検索語とタグをサーバーが SQL で絞って渡す。ここでは
 * もう一度絞らない（著者のhandleなど、サーバーだけが見る列で合致した記事を落とさないため）。
 * 公開方法・読む内容の絞り込みと、Hubpedia の絞り込みはここで行う。
 * このファイルはクライアントなので、サーバー専用・種データのモジュールを読み込まない。
 */

export type V2ArticleSort = "recommended" | "latest";

/* 無料は既定なので札にしない。成人向け・販売の札だけ出す。 */
const paidBadges = (article: HubArticleContent) => articleBadges(article).filter((badge) => badge !== "無料");

export function V2ArticleList({
  articles,
  access,
  kind = "all",
  query,
  tag = "",
  sort = "recommended",
  locale,
  extras = {},
  nextHref = null,
  emptyAction = true,
}: {
  articles: HubArticleContent[];
  access: V2ArticleAccess;
  kind?: V2ArticleKind;
  query: string;
  tag?: string;
  sort?: V2ArticleSort;
  locale: string;
  extras?: ArticleCardExtras;
  /** 次のページ（keysetカーソル付きのURL）。無ければ最後。 */
  nextHref?: string | null;
  emptyAction?: boolean;
}) {
  const ja = locale === "ja";
  const { interests, enabled, record } = useHubRecommendations();
  const feedback = useDiscoveryFeedback("articles");
  const recommended = sort === "recommended" && !query;
  const feedbackId = (article: HubArticleContent) => `${article.source}:${article.contentId}`;

  const visible = useMemo(() => {
    const filtered = articles.filter((article) => {
      if (!matchesArticleKind(article, kind)) return false;
      // Hubの書き手の記事はサーバーで検索語・タグを適用済み。
      const member = article.source === "member";
      if (!member && !matchesArticle(article, access, query)) return false;
      if (!member && tag && !(article.tags ?? []).includes(tag)) return false;
      return true;
    });
    if (sort === "latest") {
      return filtered.map((article, index) => ({ article, index })).sort((left, right) => {
        const leftTime = Date.parse(left.article.publishedAt ?? "");
        const rightTime = Date.parse(right.article.publishedAt ?? "");
        const leftValue = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
        const rightValue = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
        return rightValue - leftValue || left.index - right.index;
      }).map(({ article }) => article);
    }
    return rankDiscoveryItems(filtered, enabled ? interests : [], (article) => ({
      text: `${article.title} ${article.summary} ${(article.tags ?? []).join(" ")}`,
      author: article.author,
      topic: article.tags?.[0],
    }));
  }, [articles, access, kind, query, tag, sort, enabled, interests]);

  const recordArticleInterest = useCallback((article: HubArticleContent) => {
    if (article.access !== "public" || !article.tags?.length) return;
    record("hubpedia", article.tags);
  }, [record]);
  const shown = visible.filter(article => !recommended || !feedback.isHidden(feedbackId(article)))
    .sort((a, b) => recommended ? Number(Boolean(a.recommendationAuthorKey && feedback.isAuthorReduced(a.recommendationAuthorKey))) - Number(Boolean(b.recommendationAuthorKey && feedback.isAuthorReduced(b.recommendationAuthorKey))) : 0);

  return (
    <div className="v2-alist">
      {recommended ? <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} /> : null}

      {shown.length ? (
        <ul className="v2-agrid">
          {shown.map((article) => {
            const extra = extras[article.contentId];
            return (
              <li key={feedbackId(article)}>
                {article.gated ? (
                  <Link className="v2-acard v2-acard--gated" href={article.href}>
                    <span className="v2-acard__art v2-acard__art--text">
                      {article.accessGate
                        ? <V2GateBadge className="v2-acard__gate" gate={article.accessGate} japanese={ja} />
                        : <span className="v2-acard__lock">{ja ? "閲覧条件あり" : "Viewing conditions apply"}</span>}
                      <strong className="v2-acard__title v2-acard__title--cover ui-title-wrap">{article.title}</strong>
                    </span>
                    <small className="v2-acard__meta v2-acard__meta--byline">
                      <span className="v2-acard__author-name">{article.author}</span>
                      {article.publishedAt ? <span><V2RelativeTime value={article.publishedAt} locale={locale} /></span> : null}
                    </small>
                  </Link>
                ) : (
                  <Link className="v2-acard" href={article.href} onClick={() => recordArticleInterest(article)}>
                    {article.thumbnailUrl ? (
                      <MediaFrame src={article.thumbnailUrl} alt="" ratio="16/9" width={592} height={333} radius="md" className="v2-acard__art" referrerPolicy="no-referrer">
                        {paidBadges(article).slice(0, 1).map((badge) => <em key={badge} className="v2-acard__badge">{badge}</em>)}
                      </MediaFrame>
                    ) : (
                      /* 表紙が無い記事は、題を組んだ同じ16:9の面にする（行の高さをそろえる）。 */
                      <span className="v2-acard__art v2-acard__art--text">
                        <span className="v2-acard__kicker">
                          <span>{article.tags?.[0] ?? (ja ? "記事" : "Article")}</span>
                          {paidBadges(article).slice(0, 1).map((badge) => <em key={badge} className="v2-acard__badge v2-acard__badge--inline">{badge}</em>)}
                        </span>
                        <strong className="v2-acard__title v2-acard__title--cover ui-title-wrap">{article.title}</strong>
                      </span>
                    )}
                    {article.thumbnailUrl ? <strong className="v2-acard__title ui-title-wrap">{article.title}</strong> : null}
                    {article.summary ? <span className="v2-acard__summary">{article.summary}</span> : null}
                    <small className="v2-acard__meta v2-acard__meta--byline">
                      <span className="v2-acard__author">
                        {extra?.authorAvatarUrl
                          ? <img className="v2-acard__avatar" src={extra.authorAvatarUrl} alt="" width={20} height={20} loading="lazy" decoding="async" />
                          : <span className="v2-acard__avatar v2-acard__avatar--placeholder" aria-hidden="true">{article.author.trim().charAt(0) || "?"}</span>}
                        <span className="v2-acard__author-name">{article.author}</span>
                      </span>
                      {article.publishedAt ? <span><V2RelativeTime value={article.publishedAt} locale={locale} /></span> : null}
                      {extra ? <span>{ja ? `${extra.readingMinutes}分で読めます` : `${extra.readingMinutes} min read`}</span> : null}
                      {extra?.likeCount ? <span>{ja ? `いいね ${extra.likeCount}` : `${extra.likeCount} likes`}</span> : null}
                      {!extra ? <span>{article.source === "hubpedia" ? (ja ? "百科項目" : "Encyclopedia") : (ja ? "作者の記事" : "Authored article")}</span> : null}
                    </small>
                  </Link>
                )}
                {!article.gated ? <V2TagChipRow tags={article.tags} kind="articles" max={3} size="sm" label={ja ? "タグ" : "Tags"} /> : null}
                {recommended ? <V2DiscoveryOptions text={`${article.title} ${article.summary} ${(article.tags ?? []).join(" ")}`} interests={interests} japanese={ja} dismiss={() => feedback.dismiss(feedbackId(article))} fallbackReason={ja ? "公開範囲で読める記事カタログから紹介しています。" : "Selected from the readable public article catalog."} reduceAuthor={article.recommendationAuthorKey ? () => feedback.reduceAuthor(article.recommendationAuthorKey!) : undefined} restoreAuthor={article.recommendationAuthorKey && feedback.isAuthorReduced(article.recommendationAuthorKey) ? () => feedback.restoreAuthor(article.recommendationAuthorKey!) : undefined} /> : null}
              </li>
            );
          })}
        </ul>
      ) : visible.length > 0 && recommended ? (
        <p className="v2-note">{ja ? "おすすめは非表示になっています。検索や別の並び順で探すか、設定で非表示をリセットできます。" : "Recommendations are hidden. Search, change sort, or reset hidden recommendations in settings."}</p>
      ) : (
        query || tag
          ? <V2Empty title={ja ? "一致する記事がありません" : "No articles matched"} action={{ label: ja ? "絞り込みを解除" : "Clear filters", href: "/v2/articles" }} />
          : kind === "encyclopedia"
            ? <V2Empty title={ja ? "この条件の百科項目はありません" : "No encyclopedia entries matched"} action={{ label: "Hubpedia", href: "/v2/hubpedia" }} />
          : <V2Empty title={ja ? "記事はまだありません" : "No articles yet"} action={emptyAction ? { label: ja ? "記事を書く" : "Write an article", href: "/v2/articles/new" } : undefined} />
      )}

      {nextHref ? (
        <p className="v2-alist__more"><Link className="v2-button" href={nextHref} rel="next"><span className="v2-button__label">{ja ? "さらに記事を読む" : "Older articles"}</span></Link></p>
      ) : null}

    </div>
  );
}
