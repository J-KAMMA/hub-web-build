import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { isApprovedSeedArticleSlug } from "@/lib/encyclopedia/publication-manifest";
import { normalizeHubpediaSearchText } from "@/lib/encyclopedia/search-text";
import { toHubCoreSearchEntities, type HubCoreSearchEntity } from "@/lib/platform/search-core-adapter";
import { searchWikipediaBase } from "@/lib/encyclopedia/wikipedia/search";
import { searchTerms } from "@/lib/search-relevance";
import { EMPTY_SEARCH_EXTRAS, type SearchExtras, type SearchKindCard } from "@/lib/search-extras";
import { HUB_KIND_PAGE_SIZE, searchHubKind } from "@/lib/server/d1-search-hub-kinds";
import { isMissingSchemaError, visibleCommunitySql } from "@/lib/server/community-search-visibility";
import { applyFtsPlans, planFts, type FtsTable } from "@/lib/server/fts-trigram";
import { notGatedSql } from "@/lib/server/gated-exits";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { decodeArticleCursor, encodeArticleCursor, listUserArticlePage } from "@/lib/server/d1-user-article-queries";
import { visibilityBindings, visiblePostSql, visibleProfileSql } from "@/lib/server/search-visibility";

/*
 * "もっと見る" for one kind of search result (2026-10-30).
 *
 * The first page of /api/search holds 20 per kind and is ordered by relevance. A continuation
 * page walks the same FTS5 match by rowid, newest first, using a keyset (rowid < last):
 * D1 bills rows read, and a keyset reads only the rows it returns (plus those the visibility
 * filter drops), where OFFSET would read and discard everything before the page.
 *
 * Cost per page: PAGE_SIZE + 1 FTS rows and their joined base rows, plus the visibility
 * sub-selects per row. Posts add one timeline hydration for the cards (at most PAGE_SIZE ids).
 * Articles use the existing (created_at, id) keyset and exclude gated rows in SQL before LIMIT.
 *
 * Gated posts, threads and articles are removed in SQL; a gated body never leaves the server here.
 */

export const SEARCH_MORE_PAGE_SIZE = 20;
export const SEARCH_MORE_KINDS = ["profiles", "posts", "threads", "hubpedia", "communities", "articles", "games", "research", "federated"] as const;
export type SearchMoreKind = (typeof SEARCH_MORE_KINDS)[number];

export function isSearchMoreKind(value: unknown): value is SearchMoreKind {
  return typeof value === "string" && (SEARCH_MORE_KINDS as readonly string[]).includes(value);
}

export type SearchMorePage = {
  kind: SearchMoreKind;
  coreEntities: HubCoreSearchEntity[];
  profiles?: Array<{ id: string; handle: string; displayName: string; bio: string; avatarUrl: string | null }>;
  hubpedia?: Array<{ slug: string; title: string; category: string; summary: string }>;
  threads?: Array<{ id: string; boardKey: string; title: string; postCount: number }>;
  extras?: SearchExtras;
  kinds?: SearchKindCard[];
  nextCursor: string | null;
};

const MAX_ROWID = 9_007_199_254_740_991;

/** A cursor is the last rowid seen (digits). Anything else is treated as the first page. */
export function parseRowidCursor(value: string | null | undefined): number {
  if (!value || !/^\d{1,16}$/.test(value)) return MAX_ROWID;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MAX_ROWID;
}

const WIKIPEDIA_CURSOR = "w:";

function wikipediaPage(
  kind: SearchMoreKind,
  wiki: Awaited<ReturnType<typeof searchWikipediaBase>>,
  nextCursor: string | null,
  ledger: Array<{ slug: string; title: string; category: string; summary: string }> = [],
): SearchMorePage {
  const hubpedia = [
    ...ledger,
    ...wiki.hits.map((hit) => ({ slug: hit.slug, title: hit.title, category: hit.category, summary: hit.summary })),
  ];
  return {
    kind,
    coreEntities: toHubCoreSearchEntities({ hubpedia: hubpedia.map((row) => ({ ...row, href: `/hubpedia/${encodeURIComponent(row.slug)}` })) }),
    hubpedia,
    nextCursor,
  };
}

const rowsOf = <T>(result: { results?: T[] }) => result.results ?? [];

async function ftsPlan(database: D1Database, table: FtsTable, terms: string[]) {
  const plan = await planFts(database as never, table, terms);
  return { plan, prep: (sql: string) => database.prepare(applyFtsPlans(sql, { [table]: plan })) };
}

export async function getD1SearchMore(
  database: D1Database,
  input: { kind: SearchMoreKind; query: string; viewerProfileId: string | null; cursor: string | null },
): Promise<SearchMorePage> {
  const { kind, query, viewerProfileId } = input;
  const terms = searchTerms(query);
  const empty: SearchMorePage = { kind, coreEntities: [], nextCursor: null };
  if (terms.length === 0) return empty;
  const limit = SEARCH_MORE_PAGE_SIZE;
  const before = parseRowidCursor(input.cursor);
  const viewer = visibilityBindings(viewerProfileId);
  const next = (rows: Array<{ row_id: number }>) => (rows.length > limit ? String(rows[limit - 1].row_id) : null);

  if (kind === "profiles") {
    const { plan, prep } = await ftsPlan(database, "profiles", terms);
    const rows = rowsOf(await prep(`SELECT f.rowid AS row_id, p.id, p.handle, p.display_name, p.bio, p.avatar_url
      FROM profiles_fts f JOIN profiles p ON p.rowid = f.rowid
      WHERE profiles_fts MATCH ? AND f.rowid < ? AND ${visibleProfileSql}
      ORDER BY f.rowid DESC LIMIT ?`).bind(plan.bind, before, ...viewer, limit + 1)
      .all<{ row_id: number; id: string; handle: string; display_name: string; bio: string; avatar_url: string | null }>());
    const page = rows.slice(0, limit);
    const profiles = page.map((row) => ({ id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio, avatarUrl: row.avatar_url }));
    return { kind, coreEntities: toHubCoreSearchEntities({ profiles }), profiles, nextCursor: next(rows) };
  }

  if (kind === "posts") {
    const { plan, prep } = await ftsPlan(database, "social_posts", terms);
    const rows = rowsOf(await prep(`SELECT f.rowid AS row_id, p.id, p.body
      FROM social_posts_fts f JOIN social_posts p ON p.rowid = f.rowid
      WHERE social_posts_fts MATCH ? AND f.rowid < ? AND p.moderated_at IS NULL AND ${visiblePostSql}
      ORDER BY f.rowid DESC LIMIT ?`).bind(plan.bind, before, ...viewer, limit + 1)
      .all<{ row_id: number; id: string; body: string }>());
    const page = rows.slice(0, limit);
    let cards: SearchExtras["posts"] = [];
    if (page.length) {
      try {
        cards = (await listD1TimelinePosts(database, viewerProfileId, undefined, page.length, 0, page.map((row) => row.id)) as unknown as SearchExtras["posts"])
          /* A post that picked up a gate since the read is not shown as a card. */
          .filter((post) => !post.accessGate);
      } catch {
        cards = [];
      }
    }
    const shown = new Set(cards.map((post) => post.id));
    const visible = page.filter((row) => shown.has(row.id));
    return {
      kind,
      coreEntities: toHubCoreSearchEntities({ posts: visible.map((row) => ({ id: row.id, body: row.body })) }),
      extras: { ...EMPTY_SEARCH_EXTRAS, posts: cards },
      nextCursor: next(rows),
    };
  }

  if (kind === "threads") {
    const { plan, prep } = await ftsPlan(database, "threads", terms);
    const rows = rowsOf(await prep(`SELECT f.rowid AS row_id, t.id, b.board_key, t.title,
        (SELECT count(*) FROM thread_posts tp WHERE tp.thread_id = t.id) AS post_count
      FROM threads_fts f JOIN threads t ON t.rowid = f.rowid JOIN boards b ON b.id = t.board_id
      WHERE threads_fts MATCH ? AND f.rowid < ? AND ${notGatedSql("thread", "t.id")}
      ORDER BY f.rowid DESC LIMIT ?`).bind(plan.bind, before, limit + 1)
      .all<{ row_id: number; id: string; board_key: string; title: string; post_count: number }>());
    const page = rows.slice(0, limit);
    const threads = page.map((row) => ({ id: row.id, boardKey: row.board_key, title: row.title, postCount: Number(row.post_count) }));
    return { kind, coreEntities: toHubCoreSearchEntities({ threads }), threads, nextCursor: next(rows) };
  }

  if (kind === "hubpedia" && input.cursor?.startsWith(WIKIPEDIA_CURSOR)) {
    /* The ledger is exhausted; walk the Japanese Wikipedia base layer by title (keyset on the last match title). */
    const after = input.cursor.slice(WIKIPEDIA_CURSOR.length) || null;
    const wiki = await searchWikipediaBase(database, query, { limit, after });
    return wikipediaPage(kind, wiki, wiki.hasMore ? WIKIPEDIA_CURSOR + (wiki.lastMatchTitle ?? "") : null);
  }

  if (kind === "hubpedia") {
    const { plan, prep } = await ftsPlan(database, "hubpedia", searchTerms(normalizeHubpediaSearchText(query)));
    const rows = rowsOf(await prep(`SELECT f.rowid AS row_id, a.slug, a.title, a.category, a.summary
      FROM hubpedia_articles_fts f JOIN hubpedia_articles a ON a.rowid = f.rowid
      WHERE hubpedia_articles_fts MATCH ? AND f.rowid < ? AND a.status = 'published'
        AND EXISTS (SELECT 1 FROM hubpedia_publication_approvals approval WHERE approval.article_slug = a.slug AND approval.revoked_at IS NULL)
      ORDER BY f.rowid DESC LIMIT ?`).bind(plan.bind, before, limit + 1)
      .all<{ row_id: number; slug: string; title: string; category: string; summary: string }>());
    const page = rows.slice(0, limit).filter((row) => isApprovedSeedArticleSlug(row.slug));
    const ledger = page.map((row) => ({ slug: row.slug, title: row.title, category: row.category, summary: row.summary }));
    const ledgerNext = next(rows);
    if (ledgerNext !== null) {
      return {
        kind,
        coreEntities: toHubCoreSearchEntities({ hubpedia: ledger.map((row) => ({ ...row, href: `/hubpedia/${encodeURIComponent(row.slug)}` })) }),
        hubpedia: ledger,
        nextCursor: ledgerNext,
      };
    }
    /* Last ledger page: fill the remaining slots from the base layer, and point the cursor at it if more remain. */
    const remaining = limit - ledger.length;
    const wiki = await searchWikipediaBase(database, query, { limit: Math.max(remaining, 1), excludeSlugs: new Set(ledger.map((row) => row.slug)) });
    if (remaining === 0) return { ...wikipediaPage(kind, { hits: [], lastMatchTitle: null, hasMore: false }, wiki.hits.length ? WIKIPEDIA_CURSOR : null), hubpedia: ledger, coreEntities: toHubCoreSearchEntities({ hubpedia: ledger.map((row) => ({ ...row, href: `/hubpedia/${encodeURIComponent(row.slug)}` })) }) };
    const merged = wikipediaPage(kind, wiki, wiki.hasMore ? WIKIPEDIA_CURSOR + (wiki.lastMatchTitle ?? "") : null, ledger);
    return merged;
  }

  if (kind === "communities") {
    const visible = visibleCommunitySql("c", viewerProfileId);
    let rows: Array<{ row_id: number; id: string; slug: string; name: string }>;
    try {
      const { plan, prep } = await ftsPlan(database, "communities", terms);
      rows = rowsOf(await prep(`SELECT f.rowid AS row_id, c.id, c.slug, c.name
        FROM communities_fts f JOIN communities c ON c.rowid = f.rowid
        WHERE communities_fts MATCH ? AND f.rowid < ? AND ${visible.sql}
        ORDER BY f.rowid DESC LIMIT ?`).bind(plan.bind, before, ...visible.bindings, limit + 1)
        .all<{ row_id: number; id: string; slug: string; name: string }>());
    } catch (cause) {
      /* Code may deploy before migration 0299 creates communities_fts: no community results, not an error. */
      if (!isMissingSchemaError(cause)) throw cause;
      return empty;
    }
    const communities = rows.slice(0, limit).map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
    return { kind, coreEntities: toHubCoreSearchEntities({ communities }), nextCursor: next(rows) };
  }

  if (kind === "games" || kind === "research" || kind === "federated") {
    const page = await searchHubKind(database, kind, query, { limit: HUB_KIND_PAGE_SIZE, before });
    return { kind, coreEntities: [], kinds: page.cards, nextCursor: page.nextCursor };
  }

  /* articles: the (created_at, id) keyset, gated rows excluded in SQL before LIMIT. */
  const page = await listUserArticlePage(database, {
    audience: "general",
    limit,
    query,
    viewerProfileId,
    excludeGated: true,
    before: decodeArticleCursor(input.cursor),
  });
  const articles = page.articles.filter((article) => !article.accessGate).map((article) => ({
    id: article.id,
    href: `/v2/articles/${article.id}`,
    title: article.title,
    summary: article.summary,
    author: article.authorName,
    authorHandle: article.authorHandle,
    thumbnailUrl: article.thumbnailUrl,
    tags: article.tags.slice(0, 5),
    publishedAt: article.createdAt,
  }));
  return {
    kind,
    coreEntities: [],
    extras: { ...EMPTY_SEARCH_EXTRAS, articles },
    nextCursor: page.nextCursor ? encodeArticleCursor(page.nextCursor) : null,
  };
}
