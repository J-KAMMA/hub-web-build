import "server-only";

import { isWikipediaResearchGateway } from "@/lib/encyclopedia/source-license-policy";
import { getInstanceOrigin } from "@/lib/instance-origin";

/*
 * Wikipedia consulted, never copied.
 *
 * COMMERCIAL_REUSE_LICENSES does not list CC BY-SA, which is a decision this
 * follows rather than works around: nothing here is stored, and every summary
 * carries the attribution the licence asks for. Copying the encyclopedia
 * instead would mean 42 million sections to embed, a month of compute, and a
 * share-alike obligation over everything derived from it.
 *
 * The API is used rather than the HTML: parsing a 900KB page with JSDOM inside
 * a Worker is a lot of work to reach a list the API already publishes.
 */
const USER_AGENT = `jkamma-hub/1.0 (${getInstanceOrigin()})`;
const LICENCE = {
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  note: "Wikipediaの文章です。引用する場合は出典と同一ライセンスでの再配布が必要です。",
} as const;

export type WikipediaLocale = "ja" | "en";

function endpoint(locale: WikipediaLocale): string {
  return `https://${locale === "en" ? "en" : "ja"}.wikipedia.org`;
}

async function ask(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`wikipedia_${response.status}`);
  return response.json();
}

export interface WikipediaHit { title: string; snippet: string; url: string }

export async function searchWikipedia(
  query: string, locale: WikipediaLocale, limit: number,
): Promise<WikipediaHit[]> {
  const trimmed = query.normalize("NFKC").trim().slice(0, 200);
  if (!trimmed) return [];
  const capped = Math.max(1, Math.min(10, Math.trunc(limit)));
  const parameters = new URLSearchParams({
    action: "query", list: "search", srsearch: trimmed,
    srlimit: String(capped), format: "json", origin: "*",
  });
  const payload = await ask(`${endpoint(locale)}/w/api.php?${parameters}`) as
    { query?: { search?: Array<{ title: string; snippet?: string }> } };
  return (payload.query?.search ?? []).map((hit) => ({
    title: hit.title,
    /* The API marks matches with HTML; an agent wants the words. */
    snippet: String(hit.snippet ?? "").replace(/<[^>]+>/g, "").trim(),
    url: `${endpoint(locale)}/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
  }));
}

export async function readWikipediaSummary(title: string, locale: WikipediaLocale) {
  const trimmed = title.normalize("NFKC").trim().slice(0, 200);
  if (!trimmed) return null;
  const payload = await ask(
    `${endpoint(locale)}/api/rest_v1/page/summary/${encodeURIComponent(trimmed.replace(/ /g, "_"))}`,
  ) as { title?: string; extract?: string; description?: string; content_urls?: { desktop?: { page?: string } } };
  if (!payload.extract) return null;
  return {
    title: payload.title ?? trimmed,
    description: payload.description ?? null,
    extract: payload.extract,
    url: payload.content_urls?.desktop?.page ?? `${endpoint(locale)}/wiki/${encodeURIComponent(trimmed)}`,
    /* The response carries no licence, so it is stated here every time. */
    ...LICENCE,
  };
}

/*
 * The article's own references. This is the part worth keeping: a citation
 * leads to a primary source, and a primary source can be read, judged and
 * cited under its own terms rather than Wikipedia's.
 */
export async function listWikipediaSources(
  title: string, locale: WikipediaLocale, limit: number,
): Promise<Array<{ url: string; host: string }>> {
  const trimmed = title.normalize("NFKC").trim().slice(0, 200);
  if (!trimmed) return [];
  const parameters = new URLSearchParams({
    action: "parse", page: trimmed, prop: "externallinks", format: "json", origin: "*",
  });
  const payload = await ask(`${endpoint(locale)}/w/api.php?${parameters}`) as
    { parse?: { externallinks?: string[] } };
  const seen = new Set<string>();
  const sources: Array<{ url: string; host: string }> = [];
  for (const raw of payload.parse?.externallinks ?? []) {
    if (sources.length >= Math.max(1, Math.min(100, Math.trunc(limit)))) break;
    try {
      const url = new URL(raw);
      /* Wikipedia citing itself is not a source; nor is a sister project. */
      if (url.protocol !== "https:") continue;
      if (isWikipediaResearchGateway({ url: url.toString() })) continue;
      if (url.hostname.endsWith("wikimedia.org") || url.hostname.endsWith("wikidata.org")) continue;
      url.hash = "";
      if (seen.has(url.toString())) continue;
      seen.add(url.toString());
      sources.push({ url: url.toString(), host: url.hostname });
    } catch {
      /* Malformed links appear in user-edited pages. */
    }
  }
  return sources;
}
