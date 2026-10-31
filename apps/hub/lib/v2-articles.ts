import { articleBlocks } from "@/lib/article-body";
import { projectMemberArticle, type HubArticleContent } from "@/lib/article-content";
import { getHubpediaRecentPublicationSlugs, getPublicReaderReadySeedArticles } from "@/lib/encyclopedia/public-seed";
import type { UserArticle } from "@/lib/server/d1-user-articles";

/* Client components import these from lib/v2-article-filters directly; this
 * module carries the Hubpedia seed and must stay server-only. */
export { articleKind, matchesArticle, matchesArticleKind, type V2ArticleAccess, type V2ArticleKind } from "@/lib/v2-article-filters";

/*
 * 記事の純粋な計算。既存の app/articles/page.tsx と unified-article-directory.tsx に
 * 分かれていたものを1か所へ。サーバー（一覧・詳細の頁）から使う。
 * クライアントの絞り込みは lib/v2-article-filters を直接読む。
 */

/* 既存の publicArticleCatalog と同じ。Hubpedia の無料記事を新しい順に24件。 */
export async function publicArticleCatalog(): Promise<HubArticleContent[]> {
  const [PUBLIC_READER_READY_SEED_ARTICLES, HUBPEDIA_RECENT_PUBLICATION_SLUGS] = await Promise.all([getPublicReaderReadySeedArticles(), getHubpediaRecentPublicationSlugs()]);
  const bySlug = new Map(PUBLIC_READER_READY_SEED_ARTICLES.map((article) => [article.slug, article]));
  const ordered = [
    ...HUBPEDIA_RECENT_PUBLICATION_SLUGS.map((slug) => bySlug.get(slug)).filter((article): article is NonNullable<typeof article> => Boolean(article)),
    ...PUBLIC_READER_READY_SEED_ARTICLES,
  ];
  const seen = new Set<string>();
  return ordered
    .filter((article) => {
      if (seen.has(article.slug)) return false;
      seen.add(article.slug);
      return true;
    })
    .slice(0, 24)
    .map((article) => ({
      contentId: `hubpedia:${article.slug}`,
      source: "hubpedia",
      title: article.title,
      summary: article.summary || article.description,
      href: `/v2/hubpedia/${article.slug}`,
      author: "Hubpedia",
      audience: "general",
      access: "public",
      tags: article.authoring?.tags ?? [article.categoryLabel],
    }));
}

/* Hubの書き手の記事。既存の /api/articles の写像を通してから、道だけ v2 へ向ける。 */
export function memberArticleContent(article: UserArticle): HubArticleContent {
  const projected = projectMemberArticle({
    id: article.id,
    title: article.title,
    summary: article.summary,
    author: article.authorName,
    authorHandle: article.authorHandle,
    tags: article.tags,
    thumbnailUrl: article.thumbnailUrl,
    audience: article.audience,
    publishedAt: article.createdAt,
    href: `/articles/${article.id}`,
  });
  return { ...projected, recommendationAuthorKey: `member:${article.authorProfileId}`, ...(article.accessGate ? { gated: true, accessGate: article.accessGate.gate } : {}), href: article.audience === "adult" ? projected.href : `/v2/articles/${article.id}` };
}

export type V2ArticleHeading = { id: string; level: 2 | 3; text: string };

/* 目次。見出しに番号で id を振る。本文の描画（V2ArticleBody）と同じ番号を使う。 */
export function articleHeadings(body: string): V2ArticleHeading[] {
  return articleBlocks(body).flatMap((block, index) =>
    block.kind === "heading" ? [{ id: `h-${index}`, level: block.level === 2 ? 2 : 3, text: block.text }] : []);
}
