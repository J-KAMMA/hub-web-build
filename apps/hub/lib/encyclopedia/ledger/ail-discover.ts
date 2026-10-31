import { isSensitiveTopicName } from "./topics";
import type { AilTerm } from "./ail-terms";
import { slugFromLabel } from "./ail-terms";

/*
 * Discovery of gap topics for the AIL "hubpedia" worker project: concrete Wikidata items that have a Japanese label but NO
 * Japanese Wikipedia sitelink, ranked by sitelink count. The Hub's term net holds only a few hundred abstract concepts, so
 * the gap pool comes from Wikidata itself (WDQS, one small class group per query: a large class such as "human" or "film"
 * exceeds the 60 second limit and is skipped when it fails). The class groups are the allowlist of ail-wikidata.ts; the
 * instance-of filter there is applied again afterwards on the full statements, so the SPARQL is only a pre-selection.
 * Read-only network access to query.wikidata.org and www.wikidata.org.
 */

/** Small class groups, each a separate WDQS query. Species and people are not listed: their classes time out. */
export const DISCOVERY_GROUPS: ReadonlyArray<{ name: string; classes: readonly string[] }> = [
  /* The first 11 groups answered within the WDQS limit on 2026-10-30; the rest (large classes) often time out, so they come last. */
  { name: "wars", classes: ["Q198", "Q178561", "Q350604"] },
  { name: "operations-events", classes: ["Q645883", "Q13418847", "Q3839081"] },
  { name: "elections-festivals", classes: ["Q40231", "Q132241", "Q7944"] },
  { name: "palaces-castles", classes: ["Q16560", "Q23413"] },
  { name: "culture-venues", classes: ["Q33506", "Q7075", "Q179700", "Q9259"] },
  { name: "cities", classes: ["Q515"] },
  { name: "towns", classes: ["Q1549591", "Q15284"] },
  { name: "reserves", classes: ["Q23397", "Q46831", "Q46169"] },
  { name: "diseases", classes: ["Q12136", "Q929833", "Q18123741"] },
  { name: "chemicals", classes: ["Q11173", "Q79529", "Q12140", "Q11344"] },
  { name: "films", classes: ["Q11424"] },
  { name: "religious-sites", classes: ["Q16970", "Q44539"] },
  { name: "sites-monuments", classes: ["Q570116", "Q839954", "Q4989906"] },
  { name: "transport", classes: ["Q12280", "Q1248784", "Q55488"] },
  { name: "mountains", classes: ["Q8502", "Q8072"] },
  { name: "waters", classes: ["Q23442", "Q4022"] },
  { name: "organisations", classes: ["Q783794", "Q891723", "Q3918", "Q875538", "Q31855", "Q327333", "Q7278", "Q484652", "Q476028", "Q7210356", "Q4438121", "Q18127"] },
  { name: "games-series", classes: ["Q7889", "Q5398426"] },
  { name: "music-comics", classes: ["Q482994", "Q21198342"] },
  { name: "art", classes: ["Q3305213", "Q860861", "Q1344"] },
  { name: "books", classes: ["Q571"] },
  { name: "literary-works", classes: ["Q7725634"] },
];

export function discoveryQuery(classes: readonly string[], minSitelinks: number, limit: number): string {
  return `SELECT ?item ?n ?ja ?en WHERE {
  VALUES ?c { ${classes.map((qid) => `wd:${qid}`).join(" ")} }
  ?item wdt:P31 ?c ; wikibase:sitelinks ?n .
  FILTER(?n >= ${Math.max(2, Math.floor(minSitelinks))})
  FILTER NOT EXISTS { ?a schema:about ?item ; schema:isPartOf <https://ja.wikipedia.org/> }
  ?item rdfs:label ?ja . FILTER(LANG(?ja) = "ja")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
} ORDER BY DESC(?n) LIMIT ${Math.max(1, Math.floor(limit))}`;
}

export type GapRow = { qid: string; sitelinks: number; labelJa: string; labelEn: string };

export function parseDiscovery(json: unknown): GapRow[] {
  const bindings = (json as { results?: { bindings?: Array<Record<string, { value?: string }>> } } | null)?.results?.bindings ?? [];
  const out = new Map<string, GapRow>();
  for (const row of bindings) {
    const qid = /\/(Q\d+)$/u.exec(row.item?.value ?? "")?.[1];
    const sitelinks = Number(row.n?.value);
    const labelJa = row.ja?.value, labelEn = row.en?.value;
    if (!qid || !Number.isFinite(sitelinks) || !labelJa || !labelEn) continue;
    out.set(qid, { qid, sitelinks, labelJa, labelEn });
  }
  return [...out.values()];
}

export type AliasInfo = { aliasesJa: string[]; aliasesEn: string[] };

/** Aliases from a wbgetentities (props=aliases, languages=ja|en) answer. */
export function parseAliases(json: unknown): Map<string, AliasInfo> {
  const entities = (json as { entities?: Record<string, { aliases?: Record<string, Array<{ value?: string }>> }> } | null)?.entities ?? {};
  const out = new Map<string, AliasInfo>();
  for (const [qid, entity] of Object.entries(entities)) {
    const pick = (lang: string) => (entity.aliases?.[lang] ?? []).map((alias) => alias.value).filter((value): value is string => Boolean(value)).slice(0, 6);
    out.set(qid, { aliasesJa: pick("ja"), aliasesEn: pick("en") });
  }
  return out;
}

const SENSITIVE_P31 = new Set(["Q12136", "Q929833", "Q18123741", "Q12140"]);

/** A term-net-shaped record for a discovered item; `p31` (when known) marks medical topics sensitive. */
export function gapTerm(row: GapRow, aliases: AliasInfo | undefined, p31: readonly string[] = []): AilTerm {
  const slug = slugFromLabel(row.labelEn);
  return {
    qid: row.qid, slug, labelJa: row.labelJa, labelEn: row.labelEn, aliasesJa: aliases?.aliasesJa ?? [], aliasesEn: aliases?.aliasesEn ?? [],
    descriptionJa: null, descriptionEn: null, sitelinks: row.sitelinks, hops: 0, seed: false, linkable: true, rev: null,
    sensitive: isSensitiveTopicName(row.labelJa, row.labelEn, slug.replace(/-/gu, " ")) || p31.some((qid) => SENSITIVE_P31.has(qid)),
    distant: false,
  };
}

const USER_AGENT = "WorldGovernmentHub-Encyclopedia/1.0 (https://hub.jkamma.com/; gap discovery; read-only)";

export type DiscoveryProgress = (message: string) => void;

/** Runs the class groups one after another (8 s apart: WDQS rate-limits bursts). A group that fails or times out is skipped and reported. */
export async function discoverGaps(
  options: { minSitelinks: number; perGroup: number; groups?: typeof DISCOVERY_GROUPS; pauseMs?: number; progress?: DiscoveryProgress; fetchJson?: (url: string) => Promise<unknown> },
): Promise<GapRow[]> {
  const fetchJson = options.fetchJson ?? (async (url: string) => {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(75_000) });
    if (!response.ok) throw new Error(`WDQS HTTP ${response.status}`);
    return response.json();
  });
  const rows = new Map<string, GapRow>();
  for (const group of options.groups ?? DISCOVERY_GROUPS) {
    try {
      const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(discoveryQuery(group.classes, options.minSitelinks, options.perGroup))}`;
      const found = parseDiscovery(await fetchJson(url));
      for (const row of found) rows.set(row.qid, row);
      options.progress?.(`${group.name}: ${found.length}`);
    } catch (error) {
      options.progress?.(`${group.name}: skipped (${error instanceof Error ? error.message.slice(0, 60) : error})`);
    }
    if (options.pauseMs !== 0) await new Promise((done) => setTimeout(done, options.pauseMs ?? 8000));
  }
  return [...rows.values()].sort((a, b) => b.sitelinks - a.sitelinks || Number(a.qid.slice(1)) - Number(b.qid.slice(1)));
}

export async function fetchAliases(qids: readonly string[], fetchJson?: (url: string) => Promise<unknown>): Promise<Map<string, AliasInfo>> {
  const get = fetchJson ?? (async (url: string) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
      if (response.status === 429 || response.status === 503) {
        await new Promise((done) => setTimeout(done, (Number(response.headers.get("retry-after")) || 20) * 1000 + attempt * 5000));
        continue;
      }
      if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
      return response.json();
    }
    throw new Error("Wikidata HTTP 429 (retries exhausted)");
  });
  const out = new Map<string, AliasInfo>();
  for (let at = 0; at < qids.length; at += 50) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=aliases&languages=ja|en&format=json&maxlag=5&ids=${qids.slice(at, at + 50).join("|")}`;
    for (const [qid, info] of parseAliases(await get(url))) out.set(qid, info);
  }
  return out;
}
