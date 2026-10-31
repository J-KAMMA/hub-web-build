import type { PublicAccessGate } from "@/lib/access-gates/types";

export type ArticleAudience = "general" | "adult";
export type ArticleAccessMode = "public";
export type ArticleSource = "hubpedia" | "adult" | "member";

export type ArticleCommerce = {
  kind: "external-sale" | "commerce-offer";
  label: string;
};

export type HubArticleContent = {
  contentId: string;
  source: ArticleSource;
  title: string;
  summary: string;
  href: string;
  author: string;
  recommendationAuthorKey?: string;
  publishedAt?: string | null;
  audience: ArticleAudience;
  access: ArticleAccessMode;
  commerce?: ArticleCommerce;
  tags?: string[];
  thumbnailUrl?: string | null;
  /** 閲覧条件つき（本文はサーバーで外されている）。 */
  gated?: boolean;
  /** 鍵つきの一覧表示用。公開してよい閲覧条件だけ（本文・要約・表紙は含まない）。 */
  accessGate?: PublicAccessGate;
};

export function articleBadges(article: HubArticleContent): string[] {
  return [
    article.audience === "adult" ? "18+" : "",
    "無料",
    article.commerce?.label ?? "",
  ].filter(Boolean);
}

export type MemberArticleListItem = {
  id: string;
  title: string;
  summary: string;
  author: string;
  authorHandle?: string | null;
  tags?: string[];
  thumbnailUrl?: string | null;
  audience?: string;
  publishedAt?: string | null;
  href: string;
};

/** Hubの書き手が公開した無料記事を、一覧の共通表示契約へ写す。 */
export function projectMemberArticle(item: MemberArticleListItem): HubArticleContent {
  return {
    contentId: `member:${item.id}`,
    source: "member",
    title: item.title,
    summary: item.summary,
    href: item.href,
    author: item.author,
    publishedAt: item.publishedAt ?? null,
    audience: item.audience === "adult" ? "adult" : "general",
    access: "public",
    tags: item.tags,
    thumbnailUrl: item.thumbnailUrl ?? null,
  };
}
