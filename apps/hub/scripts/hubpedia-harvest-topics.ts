import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractHtml } from "../lib/encyclopedia/extract";
import { FACTORY_RESEARCH_FETCH } from "../lib/encyclopedia/factory-research";
import { fetchSource } from "../lib/encyclopedia/fetcher";
import { sourceText } from "../lib/encyclopedia/source-text";
import { findTrustedSourceDomain } from "../lib/encyclopedia/trusted-source-domains";

/*
 * Harvests topic specs from an index page on a reviewed publisher, so that
 * writing specs by hand stops being the limit on how much the factory can
 * produce.
 *
 * The one judgement it makes is which pages belong to the same subject, and
 * it makes it from the URL rather than the prose: publishers of this kind
 * organise by subject path — /venus/facts/ and /venus/ are both about Venus —
 * so pages sharing a path prefix are treated as sources for one topic. That
 * matters because the evidence floor rejects a topic whose second source says
 * nothing about the subject, which is exactly what pairing by mere adjacency
 * produced when the specs were written by hand.
 *
 * Every candidate is fetched and extracted before it is written out, and the
 * title still has to be supplied by a person: naming an article is an
 * editorial act, and a slug scraped from a URL is not a title.
 */

const MINIMUM_CHARACTERS = 600;
const MAXIMUM_CANDIDATES = 120;

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function sameSitePaths(html: string, indexUrl: string) {
  const base = new URL(indexUrl);
  const paths = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#?]+)["']/gu)) {
    let url: URL;
    try {
      url = new URL(match[1], base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    if (!/^https?:$/u.test(url.protocol)) continue;
    if (/\.(?:pdf|jpe?g|png|gif|svg|zip|mp4|webm|css|js)$/iu.test(url.pathname)) continue;
    if (url.pathname === base.pathname) continue;
    paths.add(`${url.origin}${url.pathname.replace(/\/+$/u, "")}/`);
  }
  return [...paths];
}

/** Pages under the same path prefix describe the same subject. */
function subjectKey(url: string, depth: number) {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  return segments.slice(0, depth).join("/");
}

/*
 * These publishers put news beside their reference pages, and both are
 * substantial prose, so length cannot tell them apart. The URL can: a
 * reference page ends in a short noun (/facts/, /types/, /moon/) while a news
 * item carries its headline (/curiosity-reaches-1-kilometer-elevation-gain/).
 * Encyclopedia articles are built from the reference pages; a news item is
 * about one event and dates badly.
 */
function looksLikeNewsItem(url: string) {
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  return (last.match(/-/gu)?.length ?? 0) >= 3 || /^\d{4}$/u.test(last) || /\b(news|blog|press-release|feature)\b/u.test(url);
}

async function usable(url: string) {
  try {
    const fetched = await fetchSource(url, FACTORY_RESEARCH_FETCH);
    const text = sourceText(fetched);
    const characters = text.replace(/\s+/gu, "").length;
    /* Only a web page carries a title element; a PDF's first heading is part
     * of its text, so there is nothing to read here for one. */
    const heading = fetched.mimeType.includes("html")
      ? extractHtml(new TextDecoder().decode(fetched.body), fetched.finalUrl).title ?? null
      : null;
    return characters >= MINIMUM_CHARACTERS ? { url, characters, heading } : null;
  } catch {
    return null;
  }
}

async function main() {
  const indexUrl = option("index");
  const outputPath = option("output");
  if (!indexUrl || !outputPath) {
    throw new Error("Usage: npm run hubpedia:harvest -- --index=<url> --output=spec.json [--depth=1] [--limit=12]");
  }
  const trusted = findTrustedSourceDomain(indexUrl);
  if (!trusted) throw new Error(`Publisher terms for ${indexUrl} have not been reviewed; add it to trusted-source-domains.ts first.`);
  const depth = Number(option("depth") ?? "1");
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 4) throw new Error("--depth must be 1 to 4.");
  const limit = Number(option("limit") ?? "12");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 60) throw new Error("--limit must be 1 to 60.");

  const indexFetch = await fetchSource(indexUrl, FACTORY_RESEARCH_FETCH);
  const html = new TextDecoder().decode(indexFetch.body);
  const candidates = sameSitePaths(html, indexUrl).filter((url) => !looksLikeNewsItem(url)).slice(0, MAXIMUM_CANDIDATES);
  const probed = (await Promise.all(candidates.map(usable))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const bySubject = new Map<string, typeof probed>();
  for (const entry of probed) {
    const key = subjectKey(entry.url, depth);
    if (!key) continue;
    bySubject.set(key, [...(bySubject.get(key) ?? []), entry]);
  }

  const topics = [...bySubject.entries()]
    .filter(([, pages]) => pages.length >= 2)
    .map(([key, pages]) => ({ key, pages: [...pages].sort((left, right) => right.characters - left.characters).slice(0, 3) }))
    .sort((left, right) => right.pages[0].characters - left.pages[0].characters)
    .slice(0, limit)
    .map(({ key, pages }) => ({
      slug: key.split("/").pop()!.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, ""),
      title: `TODO: ${pages[0].heading ?? key}`,
      description: `TODO: この題材の説明を書く。${trusted.publisher} の ${pages.length} 件の資料から作る。`,
      topicType: "concept",
      categoryLabel: "TODO",
      sources: pages.map((page) => ({
        url: page.url,
        title: page.heading ?? page.url,
        notes: `${page.characters} characters extracted from ${trusted.publisher}.`,
      })),
    }));

  if (!topics.length) throw new Error("No subject had two usable pages under this index.");
  const absoluteOutput = resolve(outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  writeFileSync(absoluteOutput, `${JSON.stringify({ version: 1, topics }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    spec: absoluteOutput,
    publisher: trusted.publisher,
    linksFound: candidates.length,
    pagesUsable: probed.length,
    topics: topics.length,
    note: "title, description, and categoryLabel are marked TODO — naming an article is an editorial act, not a scrape.",
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Harvest failed.");
  process.exitCode = 1;
});
