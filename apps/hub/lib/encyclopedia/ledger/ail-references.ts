import { findAilSourcePublisher, matchSourceCategory, type SourceCategoryId } from "../source-categories";

/*
 * Candidate sources for a topic of the AIL "hubpedia" worker project (owner decision 2026-10-30): the external links that
 * the topic's English Wikipedia article cites (other-language articles when enwiki is missing), read through the MediaWiki
 * API (action=parse&prop=externallinks), kept only when the host is an admitted publisher (reviewed publishers or the
 * category rules of source-categories.ts), de-duplicated, at most `limit` per topic. Wikipedia is never a source: it only
 * names where to look. The pages themselves are then fetched by the ledger's own ingest (Readability + snapshot); a page
 * with no extractable text (paywall) is simply skipped by the caller.
 */

/** Wikis tried in this order for a topic; the first one where the item has an article wins. */
export const REFERENCE_WIKIS: readonly string[] = ["enwiki", "dewiki", "frwiki", "eswiki", "itwiki", "ruwiki", "zhwiki", "ptwiki", "nlwiki", "plwiki", "svwiki", "kowiki", "arwiki"];

export type WikiArticle = { wiki: string; lang: string; title: string };

/** "enwiki" -> "en"; only plain `<lang>wiki` names. */
export function langOfWiki(wiki: string): string | null {
  const match = /^([a-z]{2,3})wiki$/u.exec(wiki);
  return match ? match[1] : null;
}

/** The article to read for each item, from a wbgetentities (props=sitelinks) answer: enwiki first, then REFERENCE_WIKIS in order. */
export function pickReferenceArticles(json: unknown): Map<string, WikiArticle> {
  const entities = (json as { entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }> } | null)?.entities ?? {};
  const out = new Map<string, WikiArticle>();
  for (const [qid, entity] of Object.entries(entities)) {
    if (!/^Q\d+$/u.test(qid)) continue;
    for (const wiki of REFERENCE_WIKIS) {
      const title = entity.sitelinks?.[wiki]?.title;
      const lang = langOfWiki(wiki);
      if (title && lang) { out.set(qid, { wiki, lang, title }); break; }
    }
  }
  return out;
}

/** External links of a MediaWiki action=parse&prop=externallinks answer, scheme-relative links made https. */
export function parseExternalLinks(json: unknown): string[] {
  const links = (json as { parse?: { externallinks?: unknown } } | null)?.parse?.externallinks;
  if (!Array.isArray(links)) return [];
  return links.filter((link): link is string => typeof link === "string").map((link) => (link.startsWith("//") ? `https:${link}` : link));
}

const CATEGORY_ORDER: Record<SourceCategoryId, number> = { intergovernmental: 0, government: 1, statistics: 2, academic: 3, publisher: 4 };

export function isDoiUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "doi.org" || host === "dx.doi.org";
  } catch { return false; }
}

/** Drops the fragment and a trailing slash difference so the same page is not counted twice. */
export function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = "https:";
    return parsed.toString().replace(/\/$/u, "");
  } catch { return url; }
}

export type SelectOptions = {
  limit?: number;
  /** At most this many URLs from one publisher domain (a topic whose article cites one site 20 times still gets variety). */
  perPublisher?: number;
};

/**
 * Admitted, de-duplicated candidates from a link list, best category first (intergovernmental, government, statistics,
 * academic, publishers), keeping the order of the article within a category. DOI links are returned separately so the caller
 * can resolve them to the publisher page and run them through the same filter.
 */
export function selectCandidateUrls(links: readonly string[], options: SelectOptions = {}): { urls: string[]; doi: string[] } {
  const limit = options.limit ?? 24;
  const perPublisher = options.perPublisher ?? 2;
  const seen = new Set<string>();
  const doi: string[] = [];
  const admitted: Array<{ url: string; order: number; index: number; domain: string }> = [];
  links.forEach((link, index) => {
    const key = dedupeKey(link);
    if (seen.has(key)) return;
    seen.add(key);
    if (isDoiUrl(link)) { doi.push(link); return; }
    const match = matchSourceCategory(link);
    const trusted = findAilSourcePublisher(link);
    if (!trusted) return;
    admitted.push({ url: link, order: match ? CATEGORY_ORDER[match.category] : 1, index, domain: trusted.domain });
  });
  admitted.sort((a, b) => a.order - b.order || a.index - b.index);
  const perDomain = new Map<string, number>();
  const urls: string[] = [];
  for (const item of admitted) {
    const used = perDomain.get(item.domain) ?? 0;
    if (used >= perPublisher) continue;
    perDomain.set(item.domain, used + 1);
    urls.push(item.url);
    if (urls.length >= limit) break;
  }
  return { urls, doi };
}

export const WIKIPEDIA_API = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`;
const USER_AGENT = "WorldGovernmentHub-Encyclopedia/1.0 (https://hub.jkamma.com/; reference lookup; read-only)";

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
    if (response.status === 429 || response.status === 503) {
      await new Promise((done) => setTimeout(done, (Number(response.headers.get("retry-after")) || 15) * 1000 + attempt * 5000));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  throw new Error("HTTP 429 (retries exhausted)");
}

/** Titles of the reference article per item (50 ids a call). Items without any article in REFERENCE_WIKIS are absent. */
export async function fetchReferenceArticles(qids: readonly string[], fetchJson: (url: string) => Promise<unknown> = getJson, pauseMs = 300): Promise<Map<string, WikiArticle>> {
  const out = new Map<string, WikiArticle>();
  for (let at = 0; at < qids.length; at += 50) {
    const batch = qids.slice(at, at + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&sitefilter=${REFERENCE_WIKIS.join("|")}&format=json&maxlag=5&ids=${batch.join("|")}`;
    for (const [qid, article] of pickReferenceArticles(await fetchJson(url))) out.set(qid, article);
    if (pauseMs && at + 50 < qids.length) await new Promise((done) => setTimeout(done, pauseMs));
  }
  return out;
}

export async function fetchExternalLinks(article: WikiArticle, fetchJson: (url: string) => Promise<unknown> = getJson): Promise<string[]> {
  const url = `${WIKIPEDIA_API(article.lang)}?action=parse&page=${encodeURIComponent(article.title)}&prop=externallinks&redirects=1&format=json&formatversion=2&maxlag=5`;
  return parseExternalLinks(await fetchJson(url));
}

/** Resolves a DOI link to the page it redirects to (HEAD, redirects followed); null when it does not resolve to https. */
export async function resolveDoi(url: string, timeoutMs = 10_000): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": USER_AGENT } });
    const final = response.url;
    return final && final.startsWith("https://") && !isDoiUrl(final) ? final : null;
  } catch { return null; }
}
