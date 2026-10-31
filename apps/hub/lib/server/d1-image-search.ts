import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { IMAGE_PAGE_SIZE, decodeCursor, encodeCursor, plainText, safeHttpsUrl, type ImageItem, type ImagePage } from "@/lib/image-search";
import { notGatedSql } from "@/lib/server/gated-exits";
import { publicImageUrl } from "@/lib/server/social-post-images";

/*
 * 画像検索の Hub 内の出どころ (2026-10-29)。
 *   hub    : 公開の投稿の画像 (social_post_images)
 *   remote : 他の Hub から届いて、この Hub に公開として保存されている画像 (今は動画のサムネイル)
 * 公開でないもの (フォロワー限定・ゲート付き・取り下げ・停止中の作者・安全審査を通っていない画像・
 * ミュート／ブロック関係) は SQL で落とす。落とす判断はクライアントに渡さない。
 * ページ送りは鍵つきカーソル (最後の行の並び鍵) で、件数のずれに影響されない。
 */

export type HubImageSource = "hub" | "remote";

const MAX_TERMS = 5;

export function imageSearchTerms(query: string): string[] {
  return query
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .split(/\s+/)
    .map((term) => term.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

function likeBinding(term: string): string {
  return `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? IMAGE_PAGE_SIZE), 1), 48);
}

type HubRow = {
  image_id: string;
  post_id: string;
  width: number;
  height: number;
  alt_text: string;
  body: string;
  display_name: string;
  handle: string | null;
  created_at: string;
};

const POST_VISIBLE_SQL = "(p.audience = 'public' AND p.moderated_at IS NULL "
  + "AND (p.author_profile_id IS NULL OR ("
  + "NOT EXISTS (SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id = p.author_profile_id AND moderation.status = 'suspended') "
  + "AND NOT EXISTS (SELECT 1 FROM thread_user_controls control WHERE ? <> '' AND ((control.owner_profile_id = ? AND control.target_profile_id = p.author_profile_id "
  + "AND (control.muted = 1 OR control.blocked = 1)) OR (control.owner_profile_id = p.author_profile_id AND control.target_profile_id = ? AND control.blocked = 1))))) "
  + `AND ${notGatedSql("post", "p.id")})`;

const IMAGE_PUBLIC_SQL = "i.status = 'published' AND i.safety_status = 'clean' AND i.metadata_stripped_at IS NOT NULL";

async function tagsForPosts(database: D1Database, postIds: readonly string[]): Promise<Map<string, string[]>> {
  const byPost = new Map<string, string[]>();
  const unique = [...new Set(postIds)];
  for (let offset = 0; offset < unique.length; offset += 80) {
    const chunk = unique.slice(offset, offset + 80);
    const rows = await database.prepare(
      `SELECT l.target_id, t.display_name FROM content_tag_links l JOIN content_tags t ON t.id = l.tag_id
       WHERE l.target_type = 'social_post' AND l.target_id IN (${chunk.map(() => "?").join(",")}) ORDER BY t.use_count DESC, t.display_name`,
    ).bind(...chunk).all<{ target_id: string; display_name: string }>();
    for (const row of rows.results) byPost.set(row.target_id, [...(byPost.get(row.target_id) ?? []), row.display_name].slice(0, 8));
  }
  return byPost;
}

function hubItem(row: HubRow, tags: string[]): ImageItem {
  const title = plainText(row.alt_text, 120) || plainText(row.body, 80) || "Untitled";
  return {
    key: `hub-post:${row.image_id}`,
    kind: "hub-post",
    ref: row.image_id,
    title,
    thumbnailUrl: publicImageUrl(row.image_id),
    width: row.width,
    height: row.height,
    sourceUrl: `/v2/posts/${encodeURIComponent(row.post_id)}`,
    licence: "",
    creator: row.handle ? `@${row.handle}` : row.display_name,
    tags,
  };
}

export type HubImageQuery = {
  query: string;
  viewerId: string | null;
  cursor?: string | null;
  limit?: number;
  /* "似た画像": このタグを共有する投稿の画像。指定した投稿自身は除く。 */
  similarToPostId?: string;
};

/** Public images from Hub posts. Returns null for a cursor that does not decode. */
export async function searchHubPostImages(database: D1Database, input: HubImageQuery): Promise<ImagePage | null> {
  const limit = clampLimit(input.limit);
  const viewerId = input.viewerId ?? "";
  const decoded = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && (!decoded || decoded.s !== "hub" || typeof decoded.c !== "string" || typeof decoded.i !== "string")) return null;
  const terms = imageSearchTerms(input.query);
  const where: string[] = [IMAGE_PUBLIC_SQL, POST_VISIBLE_SQL];
  const bindings: unknown[] = [viewerId, viewerId, viewerId];
  for (const term of terms) {
    where.push("lower(coalesce(i.alt_text, '') || ' ' || p.display_name || ' ' || coalesce(p.handle, '') || ' ' || p.body) LIKE ? ESCAPE '\\'");
    bindings.push(likeBinding(term));
  }
  if (input.similarToPostId) {
    where.push("p.id <> ?");
    bindings.push(input.similarToPostId);
    where.push("EXISTS (SELECT 1 FROM content_tag_links a JOIN content_tag_links b ON b.tag_id = a.tag_id "
      + "WHERE a.target_type = 'social_post' AND a.target_id = p.id AND b.target_type = 'social_post' AND b.target_id = ?)");
    bindings.push(input.similarToPostId);
  }
  if (decoded) {
    where.push("(p.created_at < ? OR (p.created_at = ? AND i.id > ?))");
    bindings.push(decoded.c, decoded.c, decoded.i);
  }
  const rows = await database.prepare(
    "SELECT i.id AS image_id, i.post_id, i.width, i.height, i.alt_text, p.body, p.display_name, p.handle, p.created_at "
    + "FROM social_post_images i JOIN social_posts p ON p.id = i.post_id WHERE " + where.join(" AND ")
    + " ORDER BY p.created_at DESC, i.id ASC LIMIT ?",
  ).bind(...bindings, limit + 1).all<HubRow>();
  const page = rows.results.slice(0, limit);
  const tags = await tagsForPosts(database, page.map((row) => row.post_id));
  const last = page[page.length - 1];
  return {
    items: page.map((row) => hubItem(row, tags.get(row.post_id) ?? [])),
    nextCursor: rows.results.length > limit && last ? encodeCursor({ s: "hub", c: last.created_at, i: last.image_id }) : null,
  };
}

type RemoteRow = {
  object_id: string;
  title: string;
  watch_url: string;
  thumbnail_url: string | null;
  license: string;
  published_at: string;
  handle: string;
  display_name: string;
};

const REMOTE_PUBLIC_SQL = "v.removed_at IS NULL AND v.sensitive = 0 AND v.thumbnail_url IS NOT NULL "
  + "AND NOT EXISTS (SELECT 1 FROM profile_moderation_status s WHERE s.profile_id = v.profile_id AND s.status = 'suspended')";

function remoteItem(row: RemoteRow): ImageItem | null {
  const thumbnailUrl = safeHttpsUrl(row.thumbnail_url);
  const sourceUrl = safeHttpsUrl(row.watch_url);
  if (!thumbnailUrl || !sourceUrl) return null;
  return {
    key: `remote:${row.object_id}`,
    kind: "remote",
    ref: row.object_id,
    title: plainText(row.title, 120) || "Untitled",
    thumbnailUrl,
    width: null,
    height: null,
    sourceUrl,
    licence: plainText(row.license, 40),
    creator: row.handle ? `@${row.handle}` : row.display_name,
    tags: [],
  };
}

/** Public images that other Hubs announced and this Hub stores as public. */
export async function searchRemoteHubImages(database: D1Database, input: HubImageQuery): Promise<ImagePage | null> {
  const limit = clampLimit(input.limit);
  const decoded = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && (!decoded || decoded.s !== "remote" || typeof decoded.c !== "string" || typeof decoded.i !== "string")) return null;
  const where: string[] = [REMOTE_PUBLIC_SQL];
  const bindings: unknown[] = [];
  for (const term of imageSearchTerms(input.query)) {
    where.push("lower(v.title || ' ' || v.summary) LIKE ? ESCAPE '\\'");
    bindings.push(likeBinding(term));
  }
  if (decoded) {
    where.push("(v.published_at < ? OR (v.published_at = ? AND v.object_id > ?))");
    bindings.push(decoded.c, decoded.c, decoded.i);
  }
  const rows = await database.prepare(
    "SELECT v.object_id, v.title, v.watch_url, v.thumbnail_url, v.license, v.published_at, p.handle AS handle, p.display_name AS display_name "
    + "FROM remote_hub_videos v JOIN profiles p ON p.id = v.profile_id WHERE " + where.join(" AND ")
    + " ORDER BY v.published_at DESC, v.object_id ASC LIMIT ?",
  ).bind(...bindings, limit + 1).all<RemoteRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.flatMap((row) => {
      const item = remoteItem(row);
      return item ? [item] : [];
    }),
    nextCursor: rows.results.length > limit && last ? encodeCursor({ s: "remote", c: last.published_at, i: last.object_id }) : null,
  };
}

export async function searchHubImages(database: D1Database, source: HubImageSource, input: HubImageQuery): Promise<ImagePage | null> {
  return source === "remote" ? searchRemoteHubImages(database, input) : searchHubPostImages(database, input);
}

/* ---- re-reading a stored reference (boards save a reference, not authority) ---- */

/** The image as it is right now, or null if it is no longer public. */
export async function resolveHubPostImage(database: D1Database, imageId: string, viewerId: string | null): Promise<ImageItem | null> {
  const viewer = viewerId ?? "";
  const row = await database.prepare(
    "SELECT i.id AS image_id, i.post_id, i.width, i.height, i.alt_text, p.body, p.display_name, p.handle, p.created_at "
    + "FROM social_post_images i JOIN social_posts p ON p.id = i.post_id WHERE i.id = ? AND " + IMAGE_PUBLIC_SQL + " AND " + POST_VISIBLE_SQL,
  ).bind(imageId, viewer, viewer, viewer).first<HubRow>();
  return row ? hubItem(row, []) : null;
}

export async function resolveRemoteImage(database: D1Database, objectId: string): Promise<ImageItem | null> {
  const row = await database.prepare(
    "SELECT v.object_id, v.title, v.watch_url, v.thumbnail_url, v.license, v.published_at, p.handle AS handle, p.display_name AS display_name "
    + "FROM remote_hub_videos v JOIN profiles p ON p.id = v.profile_id WHERE v.object_id = ? AND " + REMOTE_PUBLIC_SQL,
  ).bind(objectId).first<RemoteRow>();
  return row ? remoteItem(row) : null;
}
