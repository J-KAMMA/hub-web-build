import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

/*
 * 記事の読む画面に要る、著者カードと前後の記事。
 * 読み取りだけ。著者のプロフィールは公開項目（名前・ハンドル・紹介文・絵）に限る。
 * 失敗しても記事そのものは出す（呼び出し側が null / 空で受ける）。
 */

export type ArticleAuthorCard = {
  id: string;
  handle: string | null;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  articleCount: number;
  following: boolean;
};

export type ArticleNeighbour = { id: string; title: string; createdAt: string };
export type ArticleNeighbours = { previous: ArticleNeighbour | null; next: ArticleNeighbour | null };

export async function loadArticleAuthorCard(
  database: D1Database,
  authorProfileId: string,
  viewerProfileId: string | null,
): Promise<ArticleAuthorCard | null> {
  try {
    const row = await database.prepare("SELECT id, handle, display_name, bio, avatar_url FROM profiles WHERE id = ? LIMIT 1")
      .bind(authorProfileId)
      .first<{ id: string; handle: string | null; display_name: string | null; bio: string | null; avatar_url: string | null }>();
    if (!row) return null;
    const count = await database.prepare(`SELECT COUNT(*) AS n FROM hub_user_articles
      WHERE author_profile_id = ? AND status = 'published' AND audience = 'general' AND moderated_at IS NULL`)
      .bind(authorProfileId)
      .first<{ n: number }>();
    let following = false;
    if (viewerProfileId && viewerProfileId !== authorProfileId) {
      const follow = await database.prepare("SELECT 1 AS f FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1")
        .bind(viewerProfileId, authorProfileId)
        .first();
      following = Boolean(follow);
    }
    return {
      id: row.id,
      handle: row.handle,
      displayName: row.display_name?.trim() || "Hubの書き手",
      bio: row.bio ?? "",
      avatarUrl: row.avatar_url,
      articleCount: Number(count?.n ?? 0),
      following,
    };
  } catch {
    return null;
  }
}

/** 同じ著者の、ひとつ古い記事（previous）とひとつ新しい記事（next）。 */
export async function loadArticleNeighbours(
  database: D1Database,
  article: { id: string; authorProfileId: string; createdAt: string },
): Promise<ArticleNeighbours> {
  const base = `FROM hub_user_articles WHERE author_profile_id = ? AND status = 'published'
    AND audience = 'general' AND moderated_at IS NULL`;
  try {
    const [previous, next] = await Promise.all([
      database.prepare(`SELECT id, title, created_at ${base} AND (created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC LIMIT 1`)
        .bind(article.authorProfileId, article.createdAt, article.createdAt, article.id)
        .first<{ id: string; title: string; created_at: string }>(),
      database.prepare(`SELECT id, title, created_at ${base} AND (created_at > ? OR (created_at = ? AND id > ?))
        ORDER BY created_at ASC, id ASC LIMIT 1`)
        .bind(article.authorProfileId, article.createdAt, article.createdAt, article.id)
        .first<{ id: string; title: string; created_at: string }>(),
    ]);
    const map = (row: { id: string; title: string; created_at: string } | null): ArticleNeighbour | null =>
      row ? { id: row.id, title: row.title, createdAt: row.created_at } : null;
    return { previous: map(previous), next: map(next) };
  } catch {
    return { previous: null, next: null };
  }
}
