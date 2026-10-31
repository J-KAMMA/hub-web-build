"use client";

import Link from "next/link";
import { useMemo } from "react";
import { V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";
import { V2Empty } from "@/components/v2/v2-empty";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { rankDiscoveryItems } from "@/lib/discovery-recommendations";

export type HubpediaDiscoveryItem = { slug: string; title: string; summary: string; category: string; published: boolean };

export function V2HubpediaDiscovery({ articles, recommended, pageNumber, pageSize, queryString, japanese, unavailable = false }: {
  articles: HubpediaDiscoveryItem[]; recommended: boolean; pageNumber: number;
  pageSize: number; queryString: string; japanese: boolean;
  unavailable?: boolean;
}) {
  const { interests, record } = useHubRecommendations();
  const feedback = useDiscoveryFeedback("hubpedia");
  const ranked = useMemo(() => recommended
    ? rankDiscoveryItems(articles, interests, article => ({ text: `${article.title} ${article.summary} ${article.category}` }))
    : articles, [articles, interests, recommended]);
  const visible = ranked.filter(article => !recommended || !feedback.isHidden(article.slug));
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const page = Math.min(pageNumber, pageCount);
  const shown = visible.slice((page - 1) * pageSize, page * pageSize);
  const href = (nextPage: number) => {
    const params = new URLSearchParams(queryString);
    params.set("page", String(nextPage));
    return `/v2/hubpedia?${params}`;
  };
  const filters = new URLSearchParams(queryString);
  const filtered = Boolean(filters.get("q")?.trim() || filters.get("category")?.trim());
  return <>
    {unavailable ? <p className="v2-error" role="status">{japanese ? "記事の一覧を取得できませんでした。表示できる記事がある場合は、その分を表示しています。" : "Could not load the article catalog. Any available articles are still shown."} <a href={href(page)}>{japanese ? "再読み込み" : "Retry"}</a></p> : null}
    {recommended ? <V2DiscoveryFeedbackStatus feedback={feedback} japanese={japanese} /> : null}
    {recommended && shown.length ? <details className="v2-discovery v2-discovery--list">
      <summary>{japanese ? "おすすめの調整" : "Recommendation options"}</summary>
      <div className="v2-discovery__panel">
        <p>{japanese ? "公開・承認済みのHubpedia記事カタログから紹介しています。" : "Selected from the public, approved Hubpedia catalog."}</p>
        <p>{japanese ? "各記事の「興味なし」で、その記事を一覧から外せます。" : "Use “Not interested” on an article to remove it from this list."}</p>
      </div>
    </details> : null}
    {recommended && ranked.length > 0 && !visible.length ? <p className="v2-note">{japanese ? "すべて非表示になっています。設定で非表示をリセットできます。" : "All recommendations are hidden. Reset them in settings."}</p> : null}
    {shown.length ? <ul className="v2-tlist v2-hrows">{shown.map(article => <li key={article.slug} className="v2-tcard v2-hrow">
      <Link className="v2-tcard__title" href={`/v2/hubpedia/${encodeURIComponent(article.slug)}`} onClick={() => record("hubpedia", [article.category], 2)}>{article.title}</Link>
      {article.summary ? <p className="v2-tcard__excerpt">{article.summary}</p> : null}
      <p className="v2-tcard__foot">
        {article.category ? <span className="v2-badge">{article.category}</span> : null}
        {article.published ? <span className="v2-badge">{japanese ? "公開記事" : "Published"}</span> : null}
      </p>
      {recommended ? <details className="v2-hrow__more">
        <summary aria-label={japanese ? "この記事の調整" : "Adjust this article"}>{"\u2026"}</summary>
        <button type="button" className="v2-discovery__dismiss v2-discovery__dismiss--inline" onClick={() => feedback.dismiss(article.slug)}>{japanese ? "興味なし" : "Not interested"}</button>
      </details> : null}
    </li>)}</ul> : unavailable ? null : ranked.length > 0 && recommended ? null : filtered
      ? <V2Empty title={japanese ? "一致する記事がありません" : "No articles matched"} action={{ label: japanese ? "絞り込みを解除" : "Clear filters", href: "/v2/hubpedia" }} />
      : <V2Empty title={japanese ? "公開記事はまだありません" : "No published articles yet"} />}
    {pageCount > 1 ? <nav className="v2-pager" aria-label={japanese ? "頁" : "Pages"}>
      {page > 1 ? <Link className="v2-card__link" href={href(page - 1)}>{japanese ? "← 前の40本" : "← Previous 40"}</Link> : <span />}
      <span className="v2-note">{page} / {pageCount}</span>
      {page < pageCount ? <Link className="v2-card__link" href={href(page + 1)}>{japanese ? "次の40本 →" : "Next 40 →"}</Link> : <span />}
    </nav> : null}
  </>;
}
