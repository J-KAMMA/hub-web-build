import { DISCOVERY_GROUPS, parseDiscovery, type GapRow } from "../ledger/ail-discover";
import type { RawEntity } from "./facts";

/*
 * Read-only Wikidata access for the fact-article factory. WDQS etiquette: a contact User-Agent, one query at a time, a pause
 * between queries, and backoff (Retry-After honoured) on 429/5xx/timeouts. The pool extends the ail-discover pool by paging
 * on sitelink bands and by retrying a failed class group class by class.
 */

export const USER_AGENT = "HubpediaWikidataFacts/1.0 (https://hub.jkamma.com/; read-only fact fetch for short encyclopedia stubs)";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export type FetchJson = (url: string) => Promise<unknown>;

/** GET JSON with backoff. Not parallel: callers await it one at a time. */
export const politeFetchJson = (accept: string, timeoutMs: number): FetchJson => async (url) => {
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept }, signal: AbortSignal.timeout(timeoutMs) });
      if (response.status === 429 || response.status === 503 || response.status === 504) {
        lastError = `HTTP ${response.status}`;
        await sleep((Number(response.headers.get("retry-after")) || 15) * 1000 + attempt * 15_000);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json() as { error?: { code?: string } };
      /* The MediaWiki API answers 200 with an error body when replication lags (maxlag): wait and ask again, never read it as "no entities". */
      if (json?.error) { lastError = `API ${json.error.code ?? "error"}`; await sleep(5_000 + attempt * 10_000); continue; }
      return json;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/^HTTP 4\d\d$/u.test(lastError)) break;
      await sleep(10_000 + attempt * 20_000);
    }
  }
  throw new Error(`Wikidata request failed: ${lastError}`);
};

export function bandQuery(classes: readonly string[], min: number, max: number | null, limit: number): string {
  return `SELECT ?item ?n ?ja ?en WHERE {
  VALUES ?c { ${classes.map((qid) => `wd:${qid}`).join(" ")} }
  ?item wdt:P31 ?c ; wikibase:sitelinks ?n .
  FILTER(?n >= ${Math.max(2, Math.floor(min))}${max === null ? "" : ` && ?n <= ${Math.floor(max)}`})
  FILTER NOT EXISTS { ?a schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> }
  ?item rdfs:label ?ja . FILTER(LANG(?ja) = "ja")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
} ORDER BY DESC(?n) LIMIT ${Math.max(1, Math.floor(limit))}`;
}

export type PoolProgress = (message: string) => void;

/**
 * Extends `seed` rows until `target` distinct items are held. Bands are tried from the highest sitelink count down; a group
 * whose query fails is retried class by class. Stops early when the target is reached.
 */
export async function extendPool(options: {
  seed: readonly GapRow[];
  target: number;
  bands: ReadonlyArray<{ min: number; max: number | null }>;
  perQuery: number;
  progress?: PoolProgress;
  fetchJson?: FetchJson;
  pauseMs?: number;
  /** Called after each query so a long discovery can be saved. */
  onRows?: (rows: GapRow[]) => void;
}): Promise<GapRow[]> {
  const fetchJson = options.fetchJson ?? politeFetchJson("application/sparql-results+json", 75_000);
  const pauseMs = options.pauseMs ?? 8_000;
  const rows = new Map<string, GapRow>(options.seed.map((row) => [row.qid, row] as const));
  const run = async (label: string, classes: readonly string[], band: { min: number; max: number | null }) => {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(bandQuery(classes, band.min, band.max, options.perQuery))}`;
    const found = parseDiscovery(await fetchJson(url));
    let added = 0;
    for (const row of found) if (!rows.has(row.qid)) { rows.set(row.qid, row); added += 1; }
    options.progress?.(`${label} [${band.min}-${band.max ?? "*"}]: ${found.length} rows, ${added} new, pool ${rows.size}`);
    options.onRows?.([...rows.values()]);
    if (pauseMs) await sleep(pauseMs);
  };
  for (const band of options.bands) {
    for (const group of DISCOVERY_GROUPS) {
      if (rows.size >= options.target) return [...rows.values()];
      try {
        await run(group.name, group.classes, band);
      } catch {
        for (const qid of group.classes) {
          if (rows.size >= options.target) break;
          try { await run(`${group.name}/${qid}`, [qid], band); } catch (error) { options.progress?.(`${group.name}/${qid} [${band.min}-${band.max ?? "*"}]: skipped (${error instanceof Error ? error.message.slice(0, 60) : error})`); }
        }
      }
    }
  }
  return [...rows.values()];
}

/** Full entities (claims, labels, descriptions, aliases in ja/en, sitelinks), 50 ids a call, one call at a time. */
export async function fetchEntities(qids: readonly string[], options: { fetchJson?: FetchJson; pauseMs?: number } = {}): Promise<Record<string, RawEntity>> {
  const fetchJson = options.fetchJson ?? politeFetchJson("application/json", 60_000);
  const out: Record<string, RawEntity> = {};
  for (let at = 0; at < qids.length; at += 50) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims|labels|descriptions|aliases|sitelinks&languages=ja|en&format=json&maxlag=5&ids=${qids.slice(at, at + 50).join("|")}`;
    const json = await fetchJson(url) as { entities?: Record<string, RawEntity> };
    for (const [qid, entity] of Object.entries(json.entities ?? {})) if (entity.missing === undefined) out[qid] = entity;
    if (options.pauseMs && at + 50 < qids.length) await sleep(options.pauseMs);
  }
  return out;
}

/** Japanese label, else English label, of items and properties. Only ids not in `known` are fetched. */
export async function fetchLabels(ids: readonly string[], known: Record<string, string | null>, options: { fetchJson?: FetchJson; pauseMs?: number } = {}): Promise<void> {
  const fetchJson = options.fetchJson ?? politeFetchJson("application/json", 60_000);
  const need = ids.filter((id) => !(id in known));
  for (let at = 0; at < need.length; at += 50) {
    const batch = need.slice(at, at + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=ja|en&format=json&maxlag=5&ids=${batch.join("|")}`;
    const json = await fetchJson(url) as { entities?: Record<string, RawEntity> };
    for (const id of batch) {
      const entity = json.entities?.[id];
      known[id] = entity?.labels?.ja?.value?.trim() || entity?.labels?.en?.value?.trim() || null;
    }
    if (options.pauseMs && at + 50 < need.length) await sleep(options.pauseMs);
  }
}
