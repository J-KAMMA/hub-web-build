import type { HubArticleContent } from "@/lib/article-content";

/*
 * Client-safe article filters. components/v2/v2-article-list.tsx is a client
 * component; importing these from lib/v2-articles.ts dragged the Hubpedia seed
 * (through publicArticleCatalog) into the browser chunk and into a second
 * server-side copy of the /v2/articles page. Keep this module free of data
 * imports. lib/v2-articles.ts re-exports everything here for server callers.
 */

export type V2ArticleAccess = "all" | "public";
export type V2ArticleKind = "authored" | "encyclopedia" | "all";

export function articleKind(value: string): V2ArticleKind {
  return value === "encyclopedia" || value === "all" ? value : "authored";
}

export function matchesArticleKind(article: HubArticleContent, kind: V2ArticleKind): boolean {
  return kind === "all" || (kind === "encyclopedia" ? article.source === "hubpedia" : article.source !== "hubpedia");
}

/* 既存の一覧と同じ判定: 公開方法の札と、題・要約・著者・タグの部分一致（NFKC）。 */
export function matchesArticle(article: HubArticleContent, access: V2ArticleAccess, query: string): boolean {
  if (access === "public" && article.access !== "public") return false;
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase();
  if (!normalized) return true;
  return `${article.title} ${article.summary} ${article.author} ${article.tags?.join(" ") ?? ""}`
    .normalize("NFKC")
    .toLocaleLowerCase()
    .includes(normalized);
}
