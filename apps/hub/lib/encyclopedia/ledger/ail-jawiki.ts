/*
 * Which Wikidata items already have a Japanese Wikipedia article. The Hub holds jawiki as its base layer, so AI-written
 * articles go only to items WITHOUT a jawiki sitelink. Answered from Wikidata (wbgetentities, props=sitelinks, 50 ids a
 * call), never from the local catalog file, and cached by the caller (data/ledger/cache/wikidata-sitelinks.json).
 */

export type SitelinkInfo = { jawiki: boolean; enwiki: boolean; count: number; checkedAt: string };
export type SitelinkCache = Record<string, SitelinkInfo>;

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const SITELINK_BATCH = 50;
export const SITELINK_CACHE_DAYS = 30;

/** Entity map of a wbgetentities answer -> info per QID. A missing or redirected entity is absent from the result. */
export function parseSitelinkResponse(json: unknown, checkedAt: string): SitelinkCache {
  const entities = (json as { entities?: Record<string, { missing?: string; sitelinks?: Record<string, unknown> }> } | null)?.entities ?? {};
  const out: SitelinkCache = {};
  for (const [qid, entity] of Object.entries(entities)) {
    if (!/^Q\d+$/u.test(qid) || entity.missing !== undefined) continue;
    const links = Object.keys(entity.sitelinks ?? {});
    out[qid] = { jawiki: links.includes("jawiki"), enwiki: links.includes("enwiki"), count: links.length, checkedAt };
  }
  return out;
}

/** The items of `qids` that the cache cannot answer (unknown, or older than SITELINK_CACHE_DAYS). */
export function staleQids(qids: readonly string[], cache: SitelinkCache, now: Date): string[] {
  const limit = now.getTime() - SITELINK_CACHE_DAYS * 86_400_000;
  return qids.filter((qid) => { const info = cache[qid]; return !info || !(Date.parse(info.checkedAt) >= limit); });
}

export async function fetchSitelinks(
  qids: readonly string[],
  options: { fetchJson?: (url: string) => Promise<unknown>; now?: Date; pauseMs?: number } = {},
): Promise<SitelinkCache> {
  const fetchJson = options.fetchJson ?? (async (url: string) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, { headers: { "user-agent": "WorldGovernmentHub-Encyclopedia/1.0 (https://hub.jkamma.com/; sitelink check; read-only)", accept: "application/json" } });
      if (response.status === 429 || response.status === 503) {
        await new Promise((done) => setTimeout(done, (Number(response.headers.get("retry-after")) || 20) * 1000 + attempt * 5000));
        continue;
      }
      if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
      return response.json();
    }
    throw new Error("Wikidata HTTP 429 (retries exhausted)");
  });
  const checkedAt = (options.now ?? new Date()).toISOString();
  const result: SitelinkCache = {};
  for (let at = 0; at < qids.length; at += SITELINK_BATCH) {
    const ids = qids.slice(at, at + SITELINK_BATCH);
    const url = `${WIKIDATA_API}?action=wbgetentities&props=sitelinks&format=json&maxlag=5&ids=${ids.join("|")}`;
    Object.assign(result, parseSitelinkResponse(await fetchJson(url), checkedAt));
    if (options.pauseMs && at + SITELINK_BATCH < qids.length) await new Promise((done) => setTimeout(done, options.pauseMs));
  }
  return result;
}
