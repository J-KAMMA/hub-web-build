import { musicWorkHref } from "@/lib/music-work-href";
import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { V2PostData } from "@/components/v2/v2-post";
import type {
  SearchArticleCard,
  SearchExtras,
  SearchKindCard,
  SearchMusicCard,
  SearchTagCard,
  SearchThreadCard,
} from "@/lib/search-extras";
import { EMPTY_SEARCH_EXTRAS } from "@/lib/search-extras";
import { listD1PopularContentTags } from "@/lib/server/d1-content-tags";
import { listD1MusicWorksPage } from "@/lib/server/d1-music";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { tagKey } from "@/lib/server/d1-tag-search";
import { listD1ThreadsPage } from "@/lib/server/d1-threads";
import { listUserArticles, type UserArticle } from "@/lib/server/d1-user-articles";
import { musicDisplayTitle, musicWorkArtworkUrl } from "@/lib/music-catalog";
import { notGatedSql, omitGated } from "@/lib/server/gated-exits";
import { findHubKinds } from "@/lib/server/d1-search-hub-kinds";
import { getInstanceOrigin } from "@/lib/instance-origin";
import { listWorkerMusicWorks } from "@/lib/server/music-worker-works";

/*
 * Articles, music, tags and tag-matched items for the v2 search page (2026-10-28).
 *
 * Cost: these run once per search, only on the first page (a cursor continuation skips them),
 * all in parallel, and each is a bounded, indexed or LIMITed read. No table is scanned in full:
 *   articles  2 reads (text match, exact tag) + 1 gate lookup, LIMIT 12 each
 *   music     1 read, LIMIT 12 (the helper's own LIKE over the catalogue, as the music page does)
 *             + the Music Worker's public catalogue over HTTP (0 D1 rows, 3 s timeout, LIMIT 12)
 *   kinds     games / research / federated: one FTS5 read each, LIMIT 12 (d1-search-hub-kinds.ts);
 *             products: Commerce public listing over HTTP, 0 D1 rows, cached 60 s
 *   tags      1 read, LIMIT 8 on content_tags by key prefix
 *   tag posts 1 read, LIMIT 8 through content_tag_links
 *   threads   1 read by tag (LIMIT 8) + 1 gate lookup
 *   follows   1 read, only when signed in and people are shown
 *   posts     the timeline hydration for the post cards shown (one listD1TimelinePosts call)
 * Each source fails soft: a read that throws only drops its own cards, never the search.
 *
 * Gated content never enters: gated articles and threads are removed, and the tag-post read and
 * the ids handed to the timeline both exclude any post that has a gate attached.
 */

const PER_KIND = 12;
const TAG_LIMIT = 8;
const TAGGED_POST_LIMIT = 8;
const POST_CARD_LIMIT = 20;

function articleCard(article: UserArticle): SearchArticleCard {
  return {
    id: article.id,
    href: `/v2/articles/${article.id}`,
    title: article.title,
    summary: article.summary,
    author: article.authorName,
    authorHandle: article.authorHandle,
    thumbnailUrl: article.thumbnailUrl,
    tags: article.tags.slice(0, 5),
    publishedAt: article.createdAt,
  };
}

async function findArticles(database: D1Database, query: string, key: string): Promise<SearchArticleCard[]> {
  const [byText, byTag] = await Promise.all([
    listUserArticles(database, { audience: "general", limit: PER_KIND, query, excludeGated: true }).catch(() => [] as UserArticle[]),
    key ? listUserArticles(database, { audience: "general", limit: PER_KIND, tag: key, excludeGated: true }).catch(() => [] as UserArticle[]) : Promise.resolve([] as UserArticle[]),
  ]);
  const seen = new Set<string>();
  return [...byText, ...byTag]
    /* A gated article keeps no summary or cover in search; it is left out entirely. */
    .filter((article) => !article.accessGate)
    .filter((article) => (seen.has(article.id) ? false : (seen.add(article.id), true)))
    .slice(0, PER_KIND)
    .map(articleCard);
}

async function findMusic(database: D1Database, query: string): Promise<SearchMusicCard[]> {
  const page = await listD1MusicWorksPage(database, PER_KIND, 0, [], [], query);
  return page.works.map((work) => ({
    id: work.id,
    href: musicWorkHref(work.id),
    title: musicDisplayTitle(work.title),
    artist: work.artist,
    genre: work.genre,
    artworkUrl: musicWorkArtworkUrl(work) ?? null,
    year: Number.isFinite(work.year) && work.year > 0 ? work.year : null,
  }));
}

/*
 * Original tracks from the Music Worker's public catalogue (GET /music/api/tracks), the read the music
 * page makes. The Worker returns only published, clean-scanned, non-hidden tracks and no object keys;
 * Hub adds nothing to that. 0 D1 rows. 3 s timeout, at most PER_KIND tracks, empty on any failure.
 */
async function findMusicOriginals(query: string): Promise<SearchMusicCard[]> {
  const works = await listWorkerMusicWorks(new URL(getInstanceOrigin()), { query, limit: PER_KIND, timeoutMs: 3_000 });
  return works.slice(0, PER_KIND).map((work) => ({
    id: work.id,
    href: musicWorkHref(work.id),
    title: musicDisplayTitle(work.title),
    artist: work.artist,
    genre: work.genre,
    artworkUrl: musicWorkArtworkUrl(work) ?? null,
    year: Number.isFinite(work.year) && work.year > 0 ? work.year : null,
  }));
}

async function findTags(database: D1Database, key: string): Promise<SearchTagCard[]> {
  if (!key) return [];
  const tags = await listD1PopularContentTags(database, TAG_LIMIT, key);
  return tags.map((tag) => ({ name: tag.name, key: tag.key, useCount: tag.useCount }));
}

async function findTaggedPostIds(database: D1Database, key: string): Promise<string[]> {
  if (!key) return [];
  const rows = await database.prepare(`SELECT s.id FROM content_tag_links l
    JOIN content_tags t ON t.id = l.tag_id
    JOIN social_posts s ON s.id = l.target_id
    WHERE l.target_type = 'social_post' AND t.normalized_key = ?
      AND s.moderated_at IS NULL AND s.audience = 'public' AND ${notGatedSql("post", "s.id")}
    ORDER BY s.created_at DESC
    LIMIT ${TAGGED_POST_LIMIT}`).bind(key).all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

async function findTaggedThreads(database: D1Database, key: string): Promise<SearchThreadCard[]> {
  if (!key) return [];
  const page = await listD1ThreadsPage(database, { tags: [key], limit: TAG_LIMIT, offset: 0, skipTotal: true });
  const open = await omitGated(database, "thread", page.threads, (thread) => thread.id);
  return open.map((thread) => ({
    id: thread.id,
    href: `/v2/threads/${encodeURIComponent(thread.id)}`,
    title: thread.title,
    boardKey: thread.boardKey,
    postCount: thread.postCount,
  }));
}

async function findFollowing(database: D1Database, viewerId: string | null, profileIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(profileIds)].slice(0, 20);
  if (!viewerId || !ids.length) return [];
  const rows = await database.prepare(`SELECT followed_profile_id FROM follows
    WHERE follower_profile_id = ? AND followed_profile_id IN (${ids.map(() => "?").join(",")})`)
    .bind(viewerId, ...ids).all<{ followed_profile_id: string }>();
  return (rows.results ?? []).map((row) => row.followed_profile_id);
}

export type SearchExtrasInput = {
  /* The normalized query, as the search itself used it. */
  query: string;
  viewerId: string | null;
  /* People and posts the core search already returned (already free of gated posts). */
  profileIds: readonly string[];
  postIds: readonly string[];
};

export async function getD1SearchExtras(database: D1Database, input: SearchExtrasInput): Promise<SearchExtras> {
  const query = input.query.trim();
  if (!query) return EMPTY_SEARCH_EXTRAS;
  const key = tagKey(query);
  const [articles, music, originals, kinds, tags, taggedIds, threads, following] = await Promise.all([
    findArticles(database, query, key).catch(() => [] as SearchArticleCard[]),
    findMusic(database, query).catch(() => [] as SearchMusicCard[]),
    findMusicOriginals(query).catch(() => [] as SearchMusicCard[]),
    findHubKinds(database, query).catch(() => [] as SearchKindCard[]),
    findTags(database, key).catch(() => [] as SearchTagCard[]),
    findTaggedPostIds(database, key).catch(() => [] as string[]),
    findTaggedThreads(database, key).catch(() => [] as SearchThreadCard[]),
    findFollowing(database, input.viewerId, input.profileIds).catch(() => [] as string[]),
  ]);
  const known = new Set(input.postIds);
  const taggedPostIds = taggedIds.filter((id) => !known.has(id));
  const cardIds = [...input.postIds, ...taggedPostIds].slice(0, POST_CARD_LIMIT);
  let posts: V2PostData[] = [];
  if (cardIds.length) {
    try {
      posts = await listD1TimelinePosts(database, input.viewerId, undefined, cardIds.length, 0, cardIds) as unknown as V2PostData[];
    } catch {
      posts = [];
    }
  }
  /* A post the timeline hands back locked (a gate appeared since the read) is not shown as a card. */
  posts = posts.filter((post) => !post.accessGate);
  const cardIdSet = new Set(posts.map((post) => post.id));
  return {
    articles,
    music: [...new Map([...originals, ...music].map((card) => [card.id, card])).values()].slice(0, PER_KIND * 2),
    kinds,
    tags,
    posts,
    taggedPostIds: taggedPostIds.filter((id) => cardIdSet.has(id)),
    threads,
    followingProfileIds: following,
  };
}
