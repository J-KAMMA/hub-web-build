import type { D1Database } from "@cloudflare/workers-types";

import type { EdgeRecord, TermRecord } from "./config";

/*
 * Internal-link candidates (docs/hubpedia-ledger.md section 4, "記事どうしのリンク"): the terms joined to a term by an
 * edge, in either direction, that already have an article. A term without an article is never offered; it counts as
 * demand instead.
 */

export type Adjacency = Map<string, Set<string>>;

export function buildAdjacency(edges: readonly Pick<EdgeRecord, "from" | "to">[]): Adjacency {
  const adjacency: Adjacency = new Map();
  const add = (a: string, b: string) => {
    const set = adjacency.get(a) ?? new Set<string>();
    set.add(b);
    adjacency.set(a, set);
  };
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  return adjacency;
}

export type LinkCandidate = { slug: string; title: string };

/** Pure form, over a snapshot. `hasArticle` takes a slug. */
export function neighbourLinks(
  qid: string,
  adjacency: Adjacency,
  terms: ReadonlyMap<string, Pick<TermRecord, "slug" | "labelJa" | "labelEn">>,
  hasArticle: (slug: string) => boolean,
  limit = 40,
): LinkCandidate[] {
  const out: LinkCandidate[] = [];
  for (const other of [...(adjacency.get(qid) ?? [])].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const term = terms.get(other);
    if (!term || !hasArticle(term.slug)) continue;
    out.push({ slug: term.slug, title: term.labelJa ?? term.labelEn ?? term.slug });
    if (out.length >= limit) break;
  }
  return out;
}

/** An article that is not archived and has a current revision counts as "the term has an article". */
const NEIGHBOURS_SQL = (direction: "out" | "in") => `
  SELECT t2.slug AS slug, COALESCE(t2.label_ja, t2.label_en, t2.slug) AS title, t2.priority_rank AS priorityRank,
         CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS hasArticle
    FROM hubpedia_terms t1
    JOIN hubpedia_term_edges e ON e.${direction === "out" ? "from_term_id" : "to_term_id"} = t1.id
    JOIN hubpedia_terms t2 ON t2.id = e.${direction === "out" ? "to_term_id" : "from_term_id"}
    LEFT JOIN encyclopedia_articles a ON a.topic_id = t2.topic_id AND a.current_revision_id IS NOT NULL AND a.status <> 'archived'
   WHERE t1.topic_id = ?`;

/**
 * Link candidates for the writer, from D1. `seedArticleSlugs` are the slugs of articles that live in code (the seed
 * articles), which have no encyclopedia_articles row. Returns [] when the topic is not in the net.
 */
export async function loadAllowedLinks(
  db: D1Database,
  topicId: string,
  options: { seedArticleSlugs?: ReadonlySet<string>; limit?: number } = {},
): Promise<LinkCandidate[]> {
  const rows: Array<{ slug: string; title: string; priorityRank: number | null; hasArticle: number }> = [];
  for (const direction of ["out", "in"] as const) {
    const result = await db.prepare(NEIGHBOURS_SQL(direction)).bind(topicId).all<(typeof rows)[number]>();
    rows.push(...(result.results ?? []));
  }
  const seen = new Set<string>();
  const links: LinkCandidate[] = [];
  rows.sort((a, b) => (a.priorityRank ?? Number.MAX_SAFE_INTEGER) - (b.priorityRank ?? Number.MAX_SAFE_INTEGER) || a.slug.localeCompare(b.slug));
  for (const row of rows) {
    if (seen.has(row.slug) || !(row.hasArticle === 1 || options.seedArticleSlugs?.has(row.slug))) continue;
    seen.add(row.slug);
    links.push({ slug: row.slug, title: row.title });
    if (links.length >= (options.limit ?? 40)) break;
  }
  return links;
}
