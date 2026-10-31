import type { FetchLike } from "../wikidata-client";

/*
 * A small fixed Wikidata, shaped like the real API answers. Tests use it through fakeWikidataFetch; nothing here
 * touches the network. QIDs are invented but the structure (labels, aliases, claims, sitelinks) is the real one.
 *
 *   Q100 global warming (seed)   --subclass_of--> Q200 climate change --part_of--> Q300 environment
 *   Q400 greenhouse gas (seed)   --facet_of-->    Q200
 *   Q500 carbon dioxide, Q501 methane  --subclass_of--> Q400   (found by the reverse query)
 *   Q601 Mercury (planet) --instance_of--> Q610 planet;  Q603 Solar System --has part--> Q601
 *   Q602 mercury (element) --instance_of--> Q620 chemical element
 */

type Spec = {
  ja?: string; en?: string; aliasesJa?: string[]; aliasesEn?: string[]; descEn?: string; descJa?: string;
  sitelinks: number; claims?: Record<string, string[]>; rev?: number; noWiki?: boolean;
};

const SPECS: Record<string, Spec> = {
  Q100: { ja: "地球温暖化", en: "global warming", aliasesJa: ["温暖化"], sitelinks: 80, claims: { P279: ["Q200"] } },
  Q200: { ja: "気候変動", en: "climate change", sitelinks: 90, claims: { P361: ["Q300"] } },
  Q300: { ja: "環境", en: "environment", sitelinks: 100 },
  Q400: { ja: "温室効果ガス", en: "greenhouse gas", aliasesEn: ["GHG"], sitelinks: 70, claims: { P1269: ["Q200"] } },
  Q500: { ja: "二酸化炭素", en: "carbon dioxide", aliasesJa: ["炭酸ガス"], sitelinks: 120, claims: { P279: ["Q400"] } },
  Q501: { ja: "メタン", en: "methane", sitelinks: 100, claims: { P279: ["Q400"] } },
  Q601: { ja: "水星", en: "Mercury", aliasesEn: ["mercury"], descEn: "planet", sitelinks: 150, claims: { P31: ["Q610"] } },
  Q602: { ja: "水銀", en: "mercury", descEn: "chemical element", sitelinks: 140, claims: { P31: ["Q620"] } },
  Q603: { ja: "太陽系", en: "Solar System", sitelinks: 160, claims: { P527: ["Q601"] } },
  Q610: { ja: "惑星", en: "planet", sitelinks: 130 },
  Q620: { ja: "元素", en: "chemical element", sitelinks: 130 },
  /* Noise terms (not reachable from the seeds; tests feed them to assembleSnapshot directly). */
  Q700: { ja: "発生", en: "occurrence", sitelinks: 20, noWiki: true }, // sitelinks, but no ja/en Wikipedia article
  Q701: { en: "need", sitelinks: 30, claims: { P31: ["Q17442446"] } }, // Wikimedia internal item
  Q702: { en: "type", sitelinks: 30, claims: { P31: ["Q151885"] } }, // abstract concept
  Q703: { ja: "使", en: "use", sitelinks: 30 }, // one-word labels too short in both languages
  Q704: { ja: "象", en: "elephant", sitelinks: 60 }, // control: a real topic
  Q705: { en: "Use (disambiguation)", sitelinks: 30, claims: { P279: ["Q4167410"] } }, // disambiguation page
};

export function rawEntity(qid: string, spec: Spec): Record<string, unknown> {
  const label = (lang: string, value?: string) => (value ? { [lang]: { language: lang, value } } : {});
  const aliases = (lang: string, list?: string[]) => (list?.length ? { [lang]: list.map((value) => ({ language: lang, value })) } : {});
  const claims: Record<string, unknown[]> = {};
  for (const [property, targets] of Object.entries(spec.claims ?? {})) {
    claims[property] = targets.map((id) => ({ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id } } } }));
  }
  return {
    id: qid, lastrevid: spec.rev ?? 1000 + Number(qid.slice(1)),
    labels: { ...label("ja", spec.ja), ...label("en", spec.en) },
    aliases: { ...aliases("ja", spec.aliasesJa), ...aliases("en", spec.aliasesEn) },
    descriptions: { ...label("ja", spec.descJa), ...label("en", spec.descEn) },
    claims,
    sitelinks: Object.fromEntries(Array.from({ length: spec.sitelinks }, (_, i) => {
      const site = spec.noWiki ? `site${i}wiki` : i === 0 ? "jawiki" : i === 1 ? "enwiki" : `site${i}wiki`;
      return [site, { site, title: qid, url: `https://example.org/${i}/${qid}` }];
    })),
  };
}

/** Reverse statements (child, property, parent) the SPARQL endpoint would return. */
export const REVERSE: Array<{ parent: string; child: string; prop: string; sitelinks: number }> = [
  { parent: "Q400", child: "Q500", prop: "P279", sitelinks: 120 },
  { parent: "Q400", child: "Q501", prop: "P279", sitelinks: 100 },
];

export const SEARCH: Record<string, Array<{ id: string; label: string; match: { type: string; text: string }; description?: string }>> = {
  "ja:水星": [{ id: "Q601", label: "水星", match: { type: "label", text: "水星" } }],
  "en:mercury": [
    { id: "Q601", label: "Mercury", match: { type: "alias", text: "mercury" } },
    { id: "Q602", label: "mercury", match: { type: "label", text: "mercury" } },
  ],
  "en:global warming": [{ id: "Q100", label: "global warming", match: { type: "label", text: "global warming" } }],
  "en:greenhouse gas": [
    { id: "Q400", label: "greenhouse gas", match: { type: "label", text: "greenhouse gas" } },
    { id: "Q40000", label: "Greenhouse gases (disambiguation)", match: { type: "label", text: "greenhouse gases" } },
  ],
};

export const ALL_QIDS = Object.keys(SPECS);

export type FakeFetchLog = { urls: string[]; maxConcurrent: number; headers: Array<Record<string, string>> };

/** A FetchLike over the fixture. `script` can answer a given call number with a status (429, 503) before the real answer. */
export function fakeWikidataFetch(options: { script?: Array<{ status: number; retryAfter?: string }>; delayMs?: number } = {}): { fetch: FetchLike; log: FakeFetchLog } {
  const log: FakeFetchLog = { urls: [], maxConcurrent: 0, headers: [] };
  let active = 0;
  let call = 0;
  const script = [...(options.script ?? [])];
  const fetchImpl: FetchLike = async (url, init) => {
    active += 1;
    log.maxConcurrent = Math.max(log.maxConcurrent, active);
    log.urls.push(url);
    log.headers.push(init.headers);
    call += 1;
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
    active -= 1;
    const step = script.shift();
    if (step) return { status: step.status, ok: false, headers: { get: (name) => (name.toLowerCase() === "retry-after" ? step.retryAfter ?? null : null) }, json: async () => ({}) };
    const parsed = new URL(url);
    const respond = (body: unknown) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body });
    if (parsed.hostname === "query.wikidata.org") {
      const query = parsed.searchParams.get("query") ?? "";
      const wanted = new Set([...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]));
      const bindings = REVERSE.filter((row) => wanted.has(row.parent)).map((row) => ({
        c: { value: `http://www.wikidata.org/entity/${row.child}` }, p: { value: `http://www.wikidata.org/entity/${row.parent}` },
        prop: { value: row.prop }, sl: { value: String(row.sitelinks) },
      }));
      return respond({ results: { bindings } });
    }
    const action = parsed.searchParams.get("action");
    if (action === "wbgetentities") {
      const ids = (parsed.searchParams.get("ids") ?? "").split("|");
      return respond({ entities: Object.fromEntries(ids.map((id) => [id, SPECS[id] ? rawEntity(id, SPECS[id]) : { id, missing: "" }])) });
    }
    if (action === "wbsearchentities") {
      const key = `${parsed.searchParams.get("language")}:${parsed.searchParams.get("search")}`;
      return respond({ search: SEARCH[key] ?? [] });
    }
    return respond({});
  };
  void call;
  return { fetch: fetchImpl, log };
}
