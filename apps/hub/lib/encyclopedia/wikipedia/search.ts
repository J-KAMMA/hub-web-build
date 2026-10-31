import type { D1Database } from "@cloudflare/workers-types";

/*
 * Title and redirect-title search over the Japanese Wikipedia base layer (migration 0304).
 *
 * Method: prefix match on the raw title through the NOCASE indexes on hubpedia_wikipedia_articles.title and
 * hubpedia_wikipedia_aliases.alias_title. A prefix is one index range (title >= p AND title < p + U+10FFFF), so a
 * query reads only the rows it returns. There is no LIKE '%x%' and no scan of these tables at query time.
 * Misses (accepted): a query that is in the middle of a title (音楽 does not find 電子音楽), readings, and
 * body text. A Hub ledger article that matches ranks above every hit from here (the callers append these last).
 *
 * Ordering is index order (title, case-insensitive for ASCII), so an exact title sorts first and shorter
 * extensions of the prefix come before longer ones.
 */

export const WIKIPEDIA_SEARCH_LABEL = "ウィキペディア由来・未検証";
export const WIKIPEDIA_SEARCH_PAGE = 20;
const MAX_QUERY_CODE_POINTS = 64;
const PREFIX_END = "\u{10FFFF}";

export type WikipediaSearchHit = {
  slug: string;
  title: string;
  summary: string;
  category: typeof WIKIPEDIA_SEARCH_LABEL;
  href: string;
};

type Row = { match_title: string; slug: string; title: string; summary: string; from_alias: number };

/** Prefix to search: NFKC, whitespace collapsed to one space. Null when empty or too long. */
export function wikipediaSearchPrefix(query: string): string | null {
  const prefix = query.normalize("NFKC").replace(/[\s_]+/gu, " ").trim();
  if (!prefix || [...prefix].length > MAX_QUERY_CODE_POINTS) return null;
  return prefix;
}

/** The typed spelling plus its katakana and hiragana forms (titles keep whichever script they were written in). */
export function wikipediaPrefixSpellings(prefix: string): string[] {
  const katakana = prefix.replace(/[ぁ-ゖ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  const hiragana = prefix.replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return [...new Set([prefix, katakana, hiragana])];
}

const ARTICLES_SQL = `SELECT title AS match_title, slug, title, summary, 0 AS from_alias
  FROM hubpedia_wikipedia_articles
  WHERE title >= ? COLLATE NOCASE AND title < ? COLLATE NOCASE AND verification_status <> 'superseded'
  ORDER BY title COLLATE NOCASE LIMIT ?`;
const ALIASES_SQL = `SELECT a.alias_title AS match_title, t.slug, t.title, t.summary, 1 AS from_alias
  FROM hubpedia_wikipedia_aliases a JOIN hubpedia_wikipedia_articles t ON t.slug = a.target_slug
  WHERE a.alias_title >= ? COLLATE NOCASE AND a.alias_title < ? COLLATE NOCASE AND t.verification_status <> 'superseded'
  ORDER BY a.alias_title COLLATE NOCASE LIMIT ?`;
const ARTICLES_AFTER_SQL = `SELECT title AS match_title, slug, title, summary, 0 AS from_alias
  FROM hubpedia_wikipedia_articles
  WHERE title >= ? COLLATE NOCASE AND title < ? COLLATE NOCASE AND title > ? COLLATE NOCASE AND verification_status <> 'superseded'
  ORDER BY title COLLATE NOCASE LIMIT ?`;
const ALIASES_AFTER_SQL = `SELECT a.alias_title AS match_title, t.slug, t.title, t.summary, 1 AS from_alias
  FROM hubpedia_wikipedia_aliases a JOIN hubpedia_wikipedia_articles t ON t.slug = a.target_slug
  WHERE a.alias_title >= ? COLLATE NOCASE AND a.alias_title < ? COLLATE NOCASE AND a.alias_title > ? COLLATE NOCASE AND t.verification_status <> 'superseded'
  ORDER BY a.alias_title COLLATE NOCASE LIMIT ?`;

/**
 * Up to `limit` base articles whose title (or redirect title) starts with the query. `after` is the last match title
 * of the previous page (keyset): only titles sorting after it are read. Fails soft: any error gives no hits.
 */
export async function searchWikipediaBase(
  db: D1Database,
  query: string,
  options: { limit?: number; after?: string | null; excludeSlugs?: ReadonlySet<string> } = {},
): Promise<{ hits: WikipediaSearchHit[]; lastMatchTitle: string | null; hasMore: boolean }> {
  const limit = options.limit ?? WIKIPEDIA_SEARCH_PAGE;
  const prefix = wikipediaSearchPrefix(query);
  if (!prefix) return { hits: [], lastMatchTitle: null, hasMore: false };
  const after = options.after ?? null;
  const fetchRows = limit + 1;
  try {
    const statements = wikipediaPrefixSpellings(prefix).flatMap((spelling) => {
      const upper = `${spelling}${PREFIX_END}`;
      const base = after === null ? [spelling, upper] : [spelling, upper, after];
      return [
        db.prepare(after === null ? ARTICLES_SQL : ARTICLES_AFTER_SQL).bind(...base, fetchRows).all<Row>(),
        db.prepare(after === null ? ALIASES_SQL : ALIASES_AFTER_SQL).bind(...base, fetchRows).all<Row>(),
      ];
    });
    const rows = (await Promise.all(statements)).flatMap((result) => result.results ?? []);
    const key = (value: string) => value.toLocaleLowerCase("en");
    rows.sort((left, right) => {
      const a = key(left.match_title);
      const b = key(right.match_title);
      return a < b ? -1 : a > b ? 1 : left.from_alias - right.from_alias;
    });
    const seen = new Set<string>(options.excludeSlugs ?? []);
    const unique: Row[] = [];
    for (const row of rows) {
      if (seen.has(row.slug)) continue;
      seen.add(row.slug);
      unique.push(row);
    }
    const page = unique.slice(0, limit);
    return {
      hits: page.map((row) => ({
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        category: WIKIPEDIA_SEARCH_LABEL,
        href: `/hubpedia/${encodeURIComponent(row.slug)}`,
      })),
      lastMatchTitle: page.length > 0 ? page[page.length - 1].match_title : null,
      hasMore: unique.length > limit,
    };
  } catch {
    return { hits: [], lastMatchTitle: null, hasMore: false };
  }
}
