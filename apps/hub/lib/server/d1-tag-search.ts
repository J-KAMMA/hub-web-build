import type { D1Database } from "@cloudflare/workers-types";
import { tagKey as sharedTagKey } from "@jkamma/content-tags";

import { notGatedSql, omitGated } from "@/lib/server/gated-exits";
import { publicVideoOriginSql } from "@/lib/server/video-public-origin";
import type { MusicWork } from "@/lib/music-catalog";
import { listD1MusicWorksByIds } from "@/lib/server/d1-music";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { listD1ThreadsPage } from "@/lib/server/d1-threads";
import { listUserArticles } from "@/lib/server/d1-user-articles";
import { listD1ExternalVideosByIds, type PublicVideoEntry } from "@/lib/server/d1-videos";
import type { AppShellTimelinePost } from "@/lib/server/app-shell-data";
import type { ThreadSummary } from "@/lib/domain";
import { memberArticleContent } from "@/lib/v2-articles";
import type { HubArticleContent } from "@/lib/article-content";

/*
 * Cross-kind tag search (2026-10-29, one tag system).
 *
 * Every listing and every count reads content_tag_links WHERE public_visible = 1, joined to the target
 * row. public_visible is maintained by triggers (gate attach/detach, moderation, publish state), and the
 * target's own visible-state and "no gate attached" predicates are repeated here as defence in depth:
 * if a trigger ever lags, a gated or hidden item still never reaches a tag page, count or cursor.
 * Matching is by the shared key (@jkamma/content-tags): whole-tag, no substring, no LIKE, so `#ai` never
 * matches `#aiart` and `%` / `_` are literal characters.
 *
 * Paging is keyset per kind on (link.created_at, target_id); the cursor is opaque to callers.
 */

export const TAG_KINDS = ["posts", "threads", "articles", "videos", "music", "market"] as const;
export type TagKind = typeof TAG_KINDS[number];

/** Counts stop at this many (bounded index scan); a count at the cap means "this many or more". */
export const TAG_COUNT_CAP = 1000;
export const TAG_ALL_PER_KIND = 6;
export const TAG_KIND_PAGE_SIZE = 24;

/** The shared key, or "" when the input is not a valid tag. Kept for callers that want a string. */
export function tagKey(raw: string): string {
  return sharedTagKey(raw) ?? "";
}

export type TagMarketProduct = {
  id: string;
  title: string;
  priceMinor: number;
  currency: string;
  imageUrl: string | null;
  seller: string;
  icon: string;
  color: string;
};

export type TagSearchResult = {
  /** Display form (the most used spelling), or the key when the tag has no row yet. */
  tag: string;
  key: string;
  posts: AppShellTimelinePost[];
  threads: ThreadSummary[];
  articles: HubArticleContent[];
  videos: PublicVideoEntry[];
  music: MusicWork[];
  market: TagMarketProduct[];
  /** Visible links per kind, capped at TAG_COUNT_CAP. */
  counts: Record<TagKind, number>;
  /** Cursor for the next page of each kind, null when there is none. */
  nextCursors: Record<TagKind, string | null>;
  /** Kinds whose query failed. The page shows an error state rather than an empty one. */
  failed: TagKind[];
};

export type TagSearchOptions = {
  /** Only list this kind (counts are still returned for every kind). */
  kind?: TagKind | null;
  /** Keyset cursor for `kind`. */
  cursor?: string | null;
  /** Page size per kind. Defaults: 6 for the all view, 24 for a single kind. */
  perKind?: number;
};

type Spec = { targetType: string; table: string; where: string };

/* The target's own visible predicates, repeated from the migration's trigger definitions. */
const SPECS: Record<TagKind, Spec> = {
  posts: {
    targetType: "social_post",
    table: "social_posts",
    where: `s.moderated_at IS NULL AND s.audience = 'public' AND ${notGatedSql("post", "s.id")}
      AND (s.author_profile_id IS NULL OR NOT EXISTS (SELECT 1 FROM profile_moderation_status pm WHERE pm.profile_id = s.author_profile_id AND pm.status = 'suspended'))`,
  },
  threads: {
    targetType: "thread",
    table: "threads",
    where: `s.moderation_status = 'active' AND s.status <> 'archived' AND s.merged_into_thread_id IS NULL AND ${notGatedSql("thread", "s.id")}`,
  },
  articles: {
    targetType: "user_article",
    table: "hub_user_articles",
    where: `s.status = 'published' AND s.audience = 'general' AND s.moderated_at IS NULL AND ${notGatedSql("article", "s.id")}`,
  },
  videos: {
    targetType: "video",
    table: "external_videos",
    where: `s.status = 'active' AND ${publicVideoOriginSql("s")} AND ${notGatedSql("video", "s.id")}`,
  },
  music: {
    targetType: "music_work",
    table: "music_works",
    where: "s.status = 'active'",
  },
  market: {
    targetType: "market_product",
    table: "market_products",
    where: "s.status = 'published'",
  },
};

export type TagCursor = { at: string; id: string };

export function encodeTagCursor(cursor: TagCursor): string {
  return encodeURIComponent(JSON.stringify([cursor.at, cursor.id]));
}

export function decodeTagCursor(value: string | null | undefined): TagCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string" && parsed[0] && parsed[1]) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // A malformed cursor starts from the first page.
  }
  return null;
}

async function countKind(database: D1Database, kind: TagKind, key: string): Promise<number> {
  const spec = SPECS[kind];
  const row = await database.prepare(`SELECT COUNT(*) AS n FROM (
      SELECT 1 FROM content_tag_links l
      JOIN content_tags t ON t.id = l.tag_id
      JOIN ${spec.table} s ON s.id = l.target_id
      WHERE t.normalized_key = ? AND l.target_type = ? AND l.public_visible = 1 AND ${spec.where}
      LIMIT ${TAG_COUNT_CAP}
    )`).bind(key, spec.targetType).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** One page of visible target ids, newest link first. Fetches one extra row to know whether a next page exists. */
async function pageIds(database: D1Database, kind: TagKind, key: string, limit: number, cursor: TagCursor | null): Promise<{ ids: string[]; next: string | null }> {
  const spec = SPECS[kind];
  const after = cursor ? "AND (l.created_at < ? OR (l.created_at = ? AND l.target_id < ?))" : "";
  const bindings: Array<string | number> = [key, spec.targetType, ...(cursor ? [cursor.at, cursor.at, cursor.id] : []), limit + 1];
  const result = await database.prepare(`SELECT l.target_id AS id, l.created_at AS at FROM content_tag_links l
      JOIN content_tags t ON t.id = l.tag_id
      JOIN ${spec.table} s ON s.id = l.target_id
      WHERE t.normalized_key = ? AND l.target_type = ? AND l.public_visible = 1 AND ${spec.where} ${after}
      ORDER BY l.created_at DESC, l.target_id DESC
      LIMIT ?`).bind(...bindings).all<{ id: string; at: string }>();
  const rows = result.results ?? [];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { ids: page.map((row) => row.id), next: rows.length > limit && last ? encodeTagCursor({ at: last.at, id: last.id }) : null };
}

/** Rows come back in any order from an IN query; put them back in the order the link index gave. */
function inOrder<T>(ids: readonly string[], items: readonly T[], idOf: (item: T) => string): T[] {
  const byId = new Map(items.map((item) => [idOf(item), item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

async function hydrateMarket(database: D1Database, ids: readonly string[]): Promise<TagMarketProduct[]> {
  if (!ids.length) return [];
  const result = await database.prepare(`SELECT id, title, price_minor, currency, image_url, seller, icon, color
    FROM market_products WHERE status = 'published' AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids).all<{ id: string; title: string; price_minor: number; currency: string; image_url: string | null; seller: string; icon: string; color: string }>();
  return inOrder(ids, (result.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    priceMinor: Number(row.price_minor),
    currency: row.currency,
    imageUrl: row.image_url,
    seller: row.seller,
    icon: row.icon,
    color: row.color,
  })), (item) => item.id);
}

async function hydrate(database: D1Database, kind: TagKind, ids: readonly string[], viewerId: string | null): Promise<unknown[]> {
  if (!ids.length) return [];
  switch (kind) {
    case "posts": {
      const posts = await listD1TimelinePosts(database, viewerId, undefined, ids.length, 0, ids) as AppShellTimelinePost[];
      return inOrder(ids, posts, (post) => post.id);
    }
    case "threads": {
      const page = await listD1ThreadsPage(database, { ids: [...ids], limit: ids.length, offset: 0, skipTotal: true });
      const open = await omitGated(database, "thread", page.threads, (thread) => thread.id);
      return inOrder(ids, open, (thread) => thread.id);
    }
    case "articles": {
      const articles = await listUserArticles(database, { audience: "general", ids, limit: ids.length });
      const open = await omitGated(database, "article", articles, (article) => article.id);
      return inOrder(ids, open, (article) => article.id).map(memberArticleContent);
    }
    case "videos": {
      const videos = await listD1ExternalVideosByIds(database, [...ids], null);
      const open = await omitGated(database, "video", videos, (video) => video.id);
      return inOrder(ids, open, (video) => video.id);
    }
    case "music":
      return listD1MusicWorksByIds(database, ids);
    case "market":
      return hydrateMarket(database, ids);
  }
}

async function displayFor(database: D1Database, key: string): Promise<string> {
  const row = await database.prepare("SELECT display_name FROM content_tags WHERE normalized_key = ? LIMIT 1")
    .bind(key).first<{ display_name: string }>().catch(() => null);
  return row?.display_name?.trim() || key;
}

export async function searchByTag(
  database: D1Database,
  rawTag: string,
  viewerId: string | null,
  options: TagSearchOptions = {},
): Promise<TagSearchResult> {
  const key = tagKey(rawTag);
  const empty: TagSearchResult = {
    tag: key,
    key,
    posts: [],
    threads: [],
    articles: [],
    videos: [],
    music: [],
    market: [],
    counts: { posts: 0, threads: 0, articles: 0, videos: 0, music: 0, market: 0 },
    nextCursors: { posts: null, threads: null, articles: null, videos: null, music: null, market: null },
    failed: [],
  };
  if (!key) return empty;

  const only = options.kind ?? null;
  const limit = Math.max(1, Math.min(48, Math.trunc(options.perKind ?? (only ? TAG_KIND_PAGE_SIZE : TAG_ALL_PER_KIND))));
  const cursor = decodeTagCursor(options.cursor);
  const result = { ...empty, counts: { ...empty.counts }, nextCursors: { ...empty.nextCursors }, failed: [] as TagKind[] };

  await Promise.all([
    ...TAG_KINDS.map(async (kind) => {
      try {
        result.counts[kind] = await countKind(database, kind, key);
      } catch {
        result.failed.push(kind);
      }
    }),
    ...TAG_KINDS.filter((kind) => !only || kind === only).map(async (kind) => {
      try {
        const { ids, next } = await pageIds(database, kind, key, limit, kind === only ? cursor : null);
        const items = await hydrate(database, kind, ids, viewerId);
        (result as unknown as Record<TagKind, unknown[]>)[kind] = items;
        result.nextCursors[kind] = next;
      } catch {
        if (!result.failed.includes(kind)) result.failed.push(kind);
      }
    }),
  ]);
  /* The spelling is revealed only while something public carries the tag; a tag held only by hidden items shows its key. */
  const visibleTotal = TAG_KINDS.reduce((sum, kind) => sum + result.counts[kind], 0);
  result.tag = visibleTotal > 0 ? await displayFor(database, key) : key;
  return result;
}
