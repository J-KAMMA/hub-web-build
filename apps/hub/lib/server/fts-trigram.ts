/**
 * Query side of the Hub FTS5 trigram indexes (migration 0298).
 *
 * unicode61 never segmented Japanese: a whole kana/kanji run was one token, so
 * 「音楽」 could not find 「電子音楽の作り方」. The trigram tokenizer indexes every
 * 3-character window and answers substring queries. Two gaps remain and are
 * handled here:
 *
 * - Terms of 1-2 characters have no trigram. They are resolved by a bounded
 *   instr() pass (recent rows only, or the rows another term already matched)
 *   and handed to the main query as a rowid list.
 * - The index holds the raw text, so a katakana body is invisible to the
 *   hiragana-folded query. Every term is therefore searched in both its
 *   hiragana and katakana spelling.
 */

export type FtsTable = "profiles" | "threads" | "thread_posts" | "social_posts" | "hubpedia" | "communities" | "games" | "research" | "remote_items";

const SPECS: Record<FtsTable, { fts: string; source: string; columns: string[] }> = {
  profiles: { fts: "profiles_fts", source: "profiles", columns: ["handle", "display_name", "bio"] },
  threads: { fts: "threads_fts", source: "threads", columns: ["title"] },
  thread_posts: { fts: "thread_posts_fts", source: "thread_posts", columns: ["display_name", "body"] },
  social_posts: { fts: "social_posts_fts", source: "social_posts", columns: ["display_name", "handle", "body"] },
  communities: { fts: "communities_fts", source: "communities", columns: ["name", "description", "category"] },
  games: { fts: "game_guide_hubs_fts", source: "game_guide_hubs", columns: ["title", "summary", "aliases"] },
  research: { fts: "research_projects_fts", source: "research_projects", columns: ["title", "description"] },
  remote_items: { fts: "remote_community_items_fts", source: "remote_community_items", columns: ["title", "body"] },
  hubpedia: {
    fts: "hubpedia_articles_fts",
    source: "hubpedia_articles",
    columns: ["title", "reading", "aliases_json", "summary", "body", "category"],
  },
};

/** Newest rows examined when no term is long enough for the trigram index. */
export const SHORT_TERM_SCAN_ROWS = 3000;
const SHORT_TERM_RESULT_ROWS = 500;
const MIN_TRIGRAM_LENGTH = 3;

export type FtsPlan = {
  table: FtsTable;
  /** True when `condition` is a real MATCH, so bm25() may be used. */
  ranked: boolean;
  /** Value to bind where the original SQL had `<table>_fts MATCH ?`. */
  bind: string;
};

type Statement = { bind: (...values: unknown[]) => { all: <T>() => Promise<{ results: T[] }> } };
type Database = { prepare: (sql: string) => Statement };

const codePoints = (value: string) => [...value].length;

/** Hiragana and katakana spellings of a term (the index keeps whichever the author typed). */
export function termSpellings(term: string): string[] {
  const hiragana = term.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const katakana = term.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return [...new Set([term, hiragana, katakana])];
}

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** FTS5 MATCH expression for terms that are all long enough for trigrams. */
export function trigramMatch(terms: string[]): string {
  return terms
    .map((term) => {
      const spellings = termSpellings(term).map(quote);
      return spellings.length > 1 ? `(${spellings.join(" OR ")})` : spellings[0];
    })
    .join(" AND ");
}

export function splitTerms(terms: string[]) {
  return {
    long: terms.filter((term) => codePoints(term) >= MIN_TRIGRAM_LENGTH),
    short: terms.filter((term) => codePoints(term) < MIN_TRIGRAM_LENGTH),
  };
}

export async function planFts(database: Database, table: FtsTable, terms: string[]): Promise<FtsPlan> {
  const { long, short } = splitTerms(terms);
  if (short.length === 0) return { table, ranked: true, bind: trigramMatch(long) };

  const spec = SPECS[table];
  const haystack = `lower(${spec.columns.map((column) => `coalesce(${column}, '')`).join(" || ' ' || ")})`;
  const bindings: string[] = [];
  const shortConditions = short.map((term) => {
    const spellings = termSpellings(term);
    bindings.push(...spellings);
    return `(${spellings.map(() => `instr(${haystack}, ?) > 0`).join(" OR ")})`;
  });
  const candidates = long.length > 0
    ? `rowid IN (SELECT rowid FROM ${spec.fts} WHERE ${spec.fts} MATCH ?)`
    : `rowid IN (SELECT rowid FROM ${spec.source} ORDER BY rowid DESC LIMIT ${SHORT_TERM_SCAN_ROWS})`;
  const sql = `SELECT rowid FROM ${spec.source} WHERE ${candidates} AND ${shortConditions.join(" AND ")} LIMIT ${SHORT_TERM_RESULT_ROWS}`;
  const values = long.length > 0 ? [trigramMatch(long), ...bindings] : bindings;
  const { results } = await database.prepare(sql).bind(...values).all<{ rowid: number }>();
  return { table, ranked: false, bind: JSON.stringify(results.map((row) => row.rowid)) };
}

/**
 * Rewrites `<x>_fts MATCH ?` to the plan's condition and, for unranked plans,
 * `bm25(<x>_fts, ...)` to a constant. The condition keeps exactly one `?`, so
 * positional bindings stay where they were. Requires the FTS table aliased `f`.
 */
export function applyFtsPlans(sql: string, plans: Partial<Record<FtsTable, FtsPlan>>): string {
  let out = sql;
  for (const [table, plan] of Object.entries(plans) as Array<[FtsTable, FtsPlan | undefined]>) {
    if (!plan || plan.ranked) continue;
    const fts = SPECS[table].fts;
    out = out
      .replaceAll(`${fts} MATCH ?`, "f.rowid IN (SELECT value FROM json_each(?))")
      .replace(new RegExp(`bm25\\(${fts}[^)]*\\)`, "g"), "0.0");
  }
  return out;
}

const escapeLike = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("%", "\%").replaceAll("_", "\_");

/**
 * Bindings for `(lower(x) LIKE ? ESCAPE '\' OR lower(x) LIKE ? ESCAPE '\')`,
 * two per term: its hiragana and katakana spellings (the stored text is raw).
 */
export function likeSpellingBindings(terms: string[]): string[] {
  return terms.flatMap((term) => {
    const hiragana = term.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    const katakana = hiragana.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
    return [`%${escapeLike(hiragana)}%`, `%${escapeLike(katakana)}%`];
  });
}
