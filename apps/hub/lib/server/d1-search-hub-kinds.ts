import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { commerceApiUrl } from "@/lib/commerce-client";
import { availablePhysicalProduct, readPublicProduct, type Product } from "@/lib/commerce-product";
import { searchTerms } from "@/lib/search-relevance";
import type { SearchKindCard, SearchKindName } from "@/lib/search-extras";
import { parseRowTimestamp, scoreSearchResult } from "@/lib/search-score";
import { applyFtsPlans, planFts, type FtsTable } from "@/lib/server/fts-trigram";

/*
 * Games, research projects, federated community items and market products in Hub search (2026-10-30).
 *
 * Hub-local kinds (games, research, federated) are trigram FTS5 matches (migration 0302) filtered in
 * SQL before LIMIT. Cost per call: the FTS match (bm25 sorts the matches) plus the joined base rows
 * it returns; the federated kind adds one domain-policy lookup per returned row. The first page
 * ranks by bm25; a continuation page ("more") walks the match by rowid, newest first.
 *
 *   games      only status = 'published'
 *   research   only visibility = 'public' and status active / paused / completed
 *   federated  only state = 'visible' items that the hosting Hub announced into a community this Hub
 *              joined, and not from a domain this Hub suspended. These are public by construction;
 *              Hub never holds gated bodies from another Hub (gated content is removed before federation).
 *
 * Products come from Commerce's public, read-only listing (GET /products?kind=...), the call the
 * market pages already make. Hub never reads Commerce storage and sends no checkout or payment data.
 * 0 D1 rows. At most 20 products, 3 s timeout, a 60 s per-isolate cache, and any failure gives
 * an empty kind.
 */

export const HUB_KIND_PAGE_SIZE = 20;
const FIRST_PAGE_SIZE = 12;
const MAX_ROWID = 9_007_199_254_740_991;

export type HubLocalKind = "games" | "research" | "federated";

type KindSpec = {
  table: FtsTable;
  fts: string;
  select: string;
  from: string;
  where: string;
  bm25: string;
};

const SPECS: Record<HubLocalKind, KindSpec> = {
  games: {
    table: "games",
    fts: "game_guide_hubs_fts",
    select: "g.slug AS id, g.title AS title, g.summary AS summary, g.updated_at AS ts, '' AS host",
    from: "game_guide_hubs_fts f JOIN game_guide_hubs g ON g.rowid = f.rowid",
    where: "g.status = 'published'",
    bm25: "bm25(game_guide_hubs_fts, 10.0, 3.0, 6.0)",
  },
  research: {
    table: "research",
    fts: "research_projects_fts",
    select: "p.id AS id, p.title AS title, p.description AS summary, p.updated_at AS ts, '' AS host",
    from: "research_projects_fts f JOIN research_projects p ON p.rowid = f.rowid",
    where: "p.visibility = 'public' AND p.status IN ('active', 'paused', 'completed')",
    bm25: "bm25(research_projects_fts, 10.0, 2.0)",
  },
  federated: {
    table: "remote_items",
    fts: "remote_community_items_fts",
    select: "i.id AS id, coalesce(i.title, '') AS title, i.body AS summary, i.published_at AS ts, c.host AS host",
    from: "remote_community_items_fts f JOIN remote_community_items i ON i.rowid = f.rowid JOIN remote_communities c ON c.id = i.remote_community_id",
    where: `i.state = 'visible' AND NOT EXISTS (
        SELECT 1 FROM federation_domain_policies d WHERE d.domain = c.host AND d.action = 'suspend')`,
    bm25: "bm25(remote_community_items_fts, 6.0, 1.0)",
  },
};

const HREF: Record<HubLocalKind, (id: string) => string> = {
  games: (id) => `/v2/games/${encodeURIComponent(id)}`,
  research: (id) => `/v2/research/${encodeURIComponent(id)}`,
  federated: () => "/v2/community/remote",
};

type Row = { row_id: number; id: string; title: string; summary: string; ts: string | null; host: string; rank: number };

const snippet = (value: string | null | undefined) => (value ?? "").replace(/\s+/gu, " ").trim().slice(0, 160);

export type HubKindPage = { cards: SearchKindCard[]; nextCursor: string | null };

export async function searchHubKind(
  database: D1Database,
  kind: HubLocalKind,
  query: string,
  options: { limit?: number; before?: number; ranked?: boolean; nowMs?: number } = {},
): Promise<HubKindPage> {
  const terms = searchTerms(query);
  if (terms.length === 0) return { cards: [], nextCursor: null };
  const spec = SPECS[kind];
  const limit = options.limit ?? FIRST_PAGE_SIZE;
  const plan = await planFts(database as never, spec.table, terms);
  const order = options.ranked ? `${spec.bm25} ASC, f.rowid DESC` : "f.rowid DESC";
  const sql = applyFtsPlans(
    `SELECT f.rowid AS row_id, ${spec.select}, ${spec.bm25} AS rank
     FROM ${spec.from}
     WHERE ${spec.fts} MATCH ? AND f.rowid < ? AND ${spec.where}
     ORDER BY ${order} LIMIT ?`,
    { [spec.table]: plan },
  );
  const result = await database.prepare(sql).bind(plan.bind, options.before ?? MAX_ROWID, limit + 1).all<Row>();
  const rows = result.results ?? [];
  const page = rows.slice(0, limit);
  const nowMs = options.nowMs ?? Date.now();
  const cards = page.map<SearchKindCard>((row) => ({
    kind,
    id: row.id,
    href: HREF[kind](row.id),
    title: row.title || snippet(row.summary).slice(0, 60),
    summary: snippet(row.summary),
    ...(kind === "federated" ? { host: row.host } : {}),
    score: scoreSearchResult({
      bm25: plan.ranked ? row.rank : null,
      heuristic: 0.5,
      timestampMs: parseRowTimestamp(row.ts),
      nowMs,
    }),
  }));
  return { cards, nextCursor: rows.length > limit ? String(page[page.length - 1].row_id) : null };
}

/* ===== market products: Commerce's public read-only listing ===== */

const PRODUCT_LIMIT = 20;
const PRODUCT_TIMEOUT_MS = 3_000;
const PRODUCT_CACHE_MS = 60_000;
const productCache = new Map<string, { at: number; products: Product[] }>();

async function listPublicProducts(kind: "physical" | "digital"): Promise<Product[]> {
  const cached = productCache.get(kind);
  if (cached && Date.now() - cached.at < PRODUCT_CACHE_MS) return cached.products;
  const response = await fetch(`${commerceApiUrl("/products")}?kind=${kind}`, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(PRODUCT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`commerce_products_http_${response.status}`);
  const body = (await response.json()) as { products?: unknown };
  if (!Array.isArray(body.products)) throw new Error("invalid_public_product");
  const products: Product[] = [];
  for (const item of body.products) {
    try {
      const product = readPublicProduct(item);
      /* Physical products must be in stock; digital ones are listed as Commerce returns them. */
      if (kind === "digital" || availablePhysicalProduct(product)) products.push(product);
    } catch {
      /* one malformed item is dropped, not the listing */
    }
  }
  productCache.set(kind, { at: Date.now(), products });
  return products;
}

export async function searchMarketProducts(query: string, nowMs = Date.now()): Promise<SearchKindCard[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  try {
    const lists = await Promise.all((["physical", "digital"] as const).map((kind) => listPublicProducts(kind).catch(() => [] as Product[])));
    const seen = new Set<string>();
    const cards: SearchKindCard[] = [];
    for (const product of lists.flat()) {
      if (seen.has(product.id)) continue;
      const title = product.title.normalize("NFKC").toLocaleLowerCase("ja");
      const text = `${title} ${product.description} ${product.seller.publicName}`.normalize("NFKC").toLocaleLowerCase("ja");
      if (!terms.every((term) => text.includes(term))) continue;
      seen.add(product.id);
      cards.push({
        kind: "products" satisfies SearchKindName,
        id: product.id,
        href: `/v2/market/products/${encodeURIComponent(product.id)}`,
        title: product.title,
        summary: snippet(product.description),
        score: scoreSearchResult({
          heuristic: terms.every((term) => title.includes(term)) ? 0.8 : 0.5,
          timestampMs: null,
          nowMs,
        }),
      });
    }
    return cards.sort((left, right) => right.score - left.score).slice(0, PRODUCT_LIMIT);
  } catch {
    return [];
  }
}

export async function findHubKinds(database: D1Database, query: string): Promise<SearchKindCard[]> {
  const local = (kind: HubLocalKind) =>
    searchHubKind(database, kind, query, { ranked: true }).then((page) => page.cards).catch(() => [] as SearchKindCard[]);
  const [games, research, federated, products] = await Promise.all([
    local("games"),
    local("research"),
    local("federated"),
    searchMarketProducts(query),
  ]);
  return [...games, ...research, ...federated, ...products];
}
