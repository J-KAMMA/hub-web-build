import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TERM_NET_RULES, WIKIDATA_USER_AGENT, type Relation } from "./config";

/*
 * Polite Wikidata client (docs/hubpedia-ledger.md section 11, "取得"). One request at a time, at most one per
 * second, maxlag=5, Retry-After honoured on 429 and 503, responses cached per QID so a second run asks for nothing.
 * The fetch function is injected so tests never touch the network.
 */

const API = "https://www.wikidata.org/w/api.php";
const SPARQL = "https://query.wikidata.org/sparql";

export type CachedEntity = {
  qid: string;
  missing?: true;
  rev: number | null;
  labelJa: string | null;
  labelEn: string | null;
  aliasesJa: string[];
  aliasesEn: string[];
  descriptionJa: string | null;
  descriptionEn: string | null;
  sitelinks: number;
  /** Whether a Japanese / English Wikipedia article exists. Absent in entities cached before this was recorded. */
  wikis?: { ja: boolean; en: boolean };
  /** This entity -> target. */
  out: Array<{ to: string; relation: Relation }>;
  /** Source -> this entity (from has-part and studied-by statements, direction already aligned). */
  inc: Array<{ from: string; relation: Relation }>;
};

export type ReverseRow = { child: string; relation: Relation; sitelinks: number };
export type SearchHit = { qid: string; label: string; description: string; matchType: string; matchText: string };

export class WikidataRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "WikidataRequestError";
  }
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type ClientOptions = {
  cacheDir: string;
  fetch?: FetchLike;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  maxRetries?: number;
  /** Serve only what is cached; any missing entry is reported as absent and nothing is requested. */
  offline?: boolean;
};

const FORWARD: Record<string, Relation> = { P279: "subclass_of", P31: "instance_of", P361: "part_of", P1269: "facet_of", P2578: "studies" };
const INCOMING: Record<string, Relation> = { P527: "part_of", P2579: "studies" };
const REVERSE_PROPS: Record<string, Relation> = { P279: "subclass_of", P361: "part_of", P1269: "facet_of", P2578: "studies", P527: "part_of", P2579: "studies" };

/** Sitelinks are always requested: the noise filter needs to know whether a Wikipedia article exists. */
export const ENTITY_PROPS = "info|labels|aliases|descriptions|claims|sitelinks/urls";

const QID = /^Q[1-9]\d*$/;
export const isQid = (value: unknown): value is string => typeof value === "string" && QID.test(value);

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, path);
}
function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

function retryAfterMs(header: string | null, now: number, fallbackMs: number) {
  if (!header) return fallbackMs;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 600_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(date - now, 0), 600_000) : fallbackMs;
}

/** Reduces a wbgetentities entity to what the net needs. Deprecated statements are ignored. */
export function reduceEntity(qid: string, raw: Record<string, unknown>): CachedEntity {
  if (raw.missing !== undefined) {
    return { qid, missing: true, rev: null, labelJa: null, labelEn: null, aliasesJa: [], aliasesEn: [], descriptionJa: null, descriptionEn: null, sitelinks: 0, out: [], inc: [] };
  }
  const text = (group: unknown, lang: string): string | null => {
    const value = (group as Record<string, { value?: unknown }> | undefined)?.[lang]?.value;
    return typeof value === "string" && value.trim() ? value : null;
  };
  const aliases = (lang: string): string[] => {
    const list = (raw.aliases as Record<string, Array<{ value?: unknown }>> | undefined)?.[lang] ?? [];
    return [...new Set(list.map((item) => item.value).filter((v): v is string => typeof v === "string" && v.trim() !== ""))];
  };
  const out = new Map<string, { to: string; relation: Relation }>();
  const inc = new Map<string, { from: string; relation: Relation }>();
  const claims = (raw.claims ?? {}) as Record<string, Array<{ rank?: string; mainsnak?: { snaktype?: string; datavalue?: { value?: { id?: unknown } } } }>>;
  for (const [property, statements] of Object.entries(claims)) {
    const forward = FORWARD[property];
    const incoming = INCOMING[property];
    if (!forward && !incoming) continue;
    for (const statement of statements) {
      if (statement.rank === "deprecated" || statement.mainsnak?.snaktype !== "value") continue;
      const target = statement.mainsnak.datavalue?.value?.id;
      if (!isQid(target) || target === qid) continue;
      if (forward) out.set(`${forward}|${target}`, { to: target, relation: forward });
      else if (incoming) inc.set(`${incoming}|${target}`, { from: target, relation: incoming });
    }
  }
  return {
    qid,
    rev: typeof raw.lastrevid === "number" ? raw.lastrevid : null,
    labelJa: text(raw.labels, "ja"),
    labelEn: text(raw.labels, "en"),
    aliasesJa: aliases("ja"),
    aliasesEn: aliases("en"),
    descriptionJa: text(raw.descriptions, "ja"),
    descriptionEn: text(raw.descriptions, "en"),
    sitelinks: Object.keys((raw.sitelinks as Record<string, unknown> | undefined) ?? {}).length,
    wikis: {
      ja: Object.hasOwn((raw.sitelinks as Record<string, unknown> | undefined) ?? {}, "jawiki"),
      en: Object.hasOwn((raw.sitelinks as Record<string, unknown> | undefined) ?? {}, "enwiki"),
    },
    out: [...out.values()].sort((a, b) => a.to.localeCompare(b.to) || a.relation.localeCompare(b.relation)),
    inc: [...inc.values()].sort((a, b) => a.from.localeCompare(b.from) || a.relation.localeCompare(b.relation)),
  };
}

export type WikidataClient = {
  entities(qids: readonly string[]): Promise<Map<string, CachedEntity>>;
  search(label: string, language: "ja" | "en"): Promise<SearchHit[]>;
  reverse(parents: readonly string[]): Promise<Map<string, ReverseRow[]>>;
  readonly stats: { requests: number; waitedMs: number };
};

export function createWikidataClient(options: ClientOptions): WikidataClient {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const minInterval = options.minIntervalMs ?? TERM_NET_RULES.minIntervalMs;
  const maxRetries = options.maxRetries ?? 5;
  const userAgent = options.userAgent ?? WIKIDATA_USER_AGENT;
  const stats = { requests: 0, waitedMs: 0 };
  let lastStart = Number.NEGATIVE_INFINITY;
  let chain: Promise<unknown> = Promise.resolve();

  async function attempt(url: string, accept: string): Promise<unknown> {
    for (let tryNumber = 0; ; tryNumber += 1) {
      const wait = lastStart + minInterval - now();
      if (wait > 0) { stats.waitedMs += wait; await sleep(wait); }
      lastStart = now();
      stats.requests += 1;
      const response = await doFetch(url, { headers: { "User-Agent": userAgent, Accept: accept } });
      let retry: number | null = null;
      let body: unknown = null;
      if (response.status === 429 || response.status === 503) {
        retry = retryAfterMs(response.headers.get("retry-after"), now(), 5_000 * (tryNumber + 1));
      } else if (!response.ok) {
        throw new WikidataRequestError(`Wikidata answered HTTP ${response.status}`, response.status);
      } else {
        body = await response.json();
        const code = (body as { error?: { code?: string } } | null)?.error?.code;
        if (code === "maxlag") retry = retryAfterMs(response.headers.get("retry-after"), now(), 5_000 * (tryNumber + 1));
        else if (code) throw new WikidataRequestError(`Wikidata API error ${code}`);
      }
      if (retry === null) return body;
      if (tryNumber >= maxRetries) throw new WikidataRequestError("Wikidata kept asking to wait; giving up for now.", response.status);
      stats.waitedMs += retry;
      await sleep(retry);
      lastStart = now();
    }
  }

  /** One at a time, in call order. */
  function request(url: string, accept = "application/json"): Promise<unknown> {
    const next = chain.then(() => attempt(url, accept));
    chain = next.catch(() => undefined);
    return next;
  }

  const entityPath = (qid: string) => join(options.cacheDir, "entities", `${qid}.json`);
  const reversePath = (qid: string) => join(options.cacheDir, "reverse", `${qid}.json`);

  return {
    stats,

    async entities(qids) {
      const result = new Map<string, CachedEntity>();
      const missing: string[] = [];
      for (const qid of [...new Set(qids)].filter(isQid)) {
        const cached = readJson<CachedEntity>(entityPath(qid));
        /* An entity cached before sitelinks were recorded has no `wikis`: online it is asked for again (the request
           always carries sitelinks/urls); offline it is served as is and the noise filter fails closed on it. */
        if (cached && (cached.missing || cached.wikis || options.offline)) result.set(qid, cached);
        else missing.push(qid);
      }
      if (options.offline) return result;
      for (let start = 0; start < missing.length; start += TERM_NET_RULES.entityBatch) {
        const batch = missing.slice(start, start + TERM_NET_RULES.entityBatch);
        const params = new URLSearchParams({
          action: "wbgetentities", format: "json", ids: batch.join("|"), languages: "ja|en",
          props: ENTITY_PROPS, maxlag: String(TERM_NET_RULES.maxlag),
        });
        const body = (await request(`${API}?${params}`)) as { entities?: Record<string, Record<string, unknown>> };
        for (const qid of batch) {
          const raw = body.entities?.[qid];
          if (!raw) continue; // a redirect or a short answer: left uncached and asked again next time
          const entity = reduceEntity(qid, raw);
          writeJson(entityPath(qid), entity);
          result.set(qid, entity);
        }
      }
      return result;
    },

    async search(label, language) {
      const key = createHash("sha256").update(label).digest("hex").slice(0, 24);
      const path = join(options.cacheDir, "search", `${language}-${key}.json`);
      const cached = readJson<SearchHit[]>(path);
      if (cached) return cached;
      if (options.offline) return [];
      const params = new URLSearchParams({
        action: "wbsearchentities", format: "json", search: label, language, uselang: language, type: "item", limit: "10",
        maxlag: String(TERM_NET_RULES.maxlag),
      });
      const body = (await request(`${API}?${params}`)) as { search?: Array<{ id?: string; label?: string; description?: string; match?: { type?: string; text?: string } }> };
      const hits = (body.search ?? []).filter((hit) => isQid(hit.id)).map((hit) => ({
        qid: hit.id as string, label: hit.label ?? "", description: hit.description ?? "",
        matchType: hit.match?.type ?? "", matchText: hit.match?.text ?? "",
      }));
      writeJson(path, hits);
      return hits;
    },

    async reverse(parents) {
      const result = new Map<string, ReverseRow[]>();
      const missing: string[] = [];
      for (const qid of [...new Set(parents)].filter(isQid)) {
        const cached = readJson<ReverseRow[]>(reversePath(qid));
        if (cached) result.set(qid, cached);
        else missing.push(qid);
      }
      if (options.offline) return result;
      for (let start = 0; start < missing.length; start += TERM_NET_RULES.reverseBatch) {
        const batch = missing.slice(start, start + TERM_NET_RULES.reverseBatch);
        const values = batch.map((qid) => `wd:${qid}`).join(" ");
        const branches = Object.keys(REVERSE_PROPS).map((property) => (INCOMING[property]
          ? `{ ?p wdt:${property} ?c . BIND("${property}" AS ?prop) }`
          : `{ ?c wdt:${property} ?p . BIND("${property}" AS ?prop) }`));
        const query = `SELECT ?c ?prop ?p ?sl WHERE { VALUES ?p { ${values} } ${branches.join(" UNION ")} OPTIONAL { ?c wikibase:sitelinks ?sl } } LIMIT 20000`;
        const params = new URLSearchParams({ format: "json", query, maxlag: String(TERM_NET_RULES.maxlag) });
        const body = (await request(`${SPARQL}?${params}`, "application/sparql-results+json")) as {
          results?: { bindings?: Array<Record<string, { value?: string }>> };
        };
        const grouped = new Map<string, Map<string, ReverseRow>>(batch.map((qid) => [qid, new Map()]));
        for (const binding of body.results?.bindings ?? []) {
          const parent = binding.p?.value?.split("/").pop();
          const child = binding.c?.value?.split("/").pop();
          const relation = REVERSE_PROPS[binding.prop?.value ?? ""];
          if (!parent || !isQid(parent) || !child || !isQid(child) || !relation || child === parent) continue;
          grouped.get(parent)?.set(`${relation}|${child}`, { child, relation, sitelinks: Number(binding.sl?.value ?? 0) || 0 });
        }
        for (const [parent, rows] of grouped) {
          const list = [...rows.values()].sort((a, b) => b.sitelinks - a.sitelinks || Number(a.child.slice(1)) - Number(b.child.slice(1)));
          writeJson(reversePath(parent), list);
          result.set(parent, list);
        }
      }
      return result;
    },
  };
}
