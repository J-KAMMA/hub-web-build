import type { D1Database } from "@cloudflare/workers-types";

import { gatedTargetIds } from "@/lib/server/gated-exits";

type Row = { id: string; author_profile_id: string; title: string; summary: string; author: string | null; tags_json: string; thumbnail_url: string | null; created_at: string };
export type ArticleDiscoveryCursor = { createdAt: string; id: string };

/** Count each public article once per tag, independently of candidate pagination. */
export async function listArticleDiscoveryTags(database: D1Database) {
  const result = await database.prepare(`SELECT tag.value AS tag, count(DISTINCT a.id) AS count
    FROM hub_user_articles a,
      json_each(CASE WHEN json_valid(a.tags_json) THEN a.tags_json ELSE '[]' END) tag
    WHERE a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL
      AND tag.type = 'text' AND length(tag.value) > 0
    GROUP BY tag.value ORDER BY count DESC, tag.value ASC`).bind().all<{ tag: string; count: number }>();
  return result.results ?? [];
}

/** Public metadata only. Article bodies remain on the separately checked reader path. */
export async function listArticleDiscoveryPage(database: D1Database, cursor: ArticleDiscoveryCursor | null = null) {
  const limit = 100;
  const condition = cursor ? "AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))" : "";
  const values = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [limit + 1];
  const result = await database.prepare(`SELECT a.id, a.author_profile_id, a.title, a.summary, p.display_name AS author,
    a.tags_json, a.thumbnail_url, a.created_at
    FROM hub_user_articles a LEFT JOIN profiles p ON p.id = a.author_profile_id
    WHERE a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL
    ${condition} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).bind(...values).all<Row>();
  const rows = result.results ?? [];
  const page = rows.slice(0, limit);
  // Gated articles keep their title; the summary, tags and thumbnail are body-derived and never leave.
  const gatedIds = await gatedTargetIds(database, "article", page.map(row => row.id));
  const articles = page.map(row => {
    const gated = gatedIds.has(row.id);
    let tags: string[] = [];
    try { const parsed: unknown = JSON.parse(row.tags_json); if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string"); } catch { /* Keep readable metadata even if tags are malformed. */ }
    return { contentId: `member:${row.id}`, source: "member" as const, title: row.title, summary: gated ? "" : row.summary, gated,
      author: row.author?.trim() || "Hubの書き手", recommendationAuthorKey: `member:${row.author_profile_id}`, tags: gated ? [] : tags, thumbnailUrl: gated ? undefined : row.thumbnail_url ?? undefined,
      publishedAt: row.created_at, audience: "general" as const, access: "public" as const,
      href: `/v2/articles/${encodeURIComponent(row.id)}` };
  });
  const last = page.at(-1);
  return { articles, nextCursor: rows.length > limit && last ? { createdAt: last.created_at, id: last.id } : null };
}
