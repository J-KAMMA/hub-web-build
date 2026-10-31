import type { TermRecord } from "../term-net/config";
import type { LedgerFeed } from "./feeds";
import { discoverSitemapUrls, LEDGER_TOPIC_ID, processLedgerUrl, type IngestDeps, type PageOutcome } from "./ingest";

/*
 * Topic-driven source discovery (docs/hubpedia-ledger.md, yield losses of the third trial).
 *
 * runLedgerFeed walks a sitemap in URL order and fetches `limit` pages per run. It has no notion of a topic, so a
 * term whose second source sits late in the alphabet waits for the cursor, and three topics of the trial ended with
 * one source. This module asks the other way round: for a term, which pages of the feed's own sitemap are about it?
 * The answer is a ranking of URL slugs against the term's English label and aliases (Wikidata aliases are the words
 * publishers use in their paths: "war" for armed conflict, "oil" for petroleum). The pages go through the same
 * processLedgerUrl as every feed page, so the publisher review, licence admission and quarantine rules are unchanged,
 * and the article gate (two sources, two claims each) is untouched: this only gives it more candidates.
 */

export const TOPIC_SOURCE_DEFAULTS = { perTopic: 6, maxFetches: 60 } as const;

const STOP = new Set(["of", "the", "and", "in", "on", "a", "an", "for", "to"]);

/** lower-case ASCII words with a trailing plural s removed ("crops" and "crop" meet). */
function words(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

/** English phrases that name a term: its label, then its aliases. Japanese names do not appear in URL paths. */
export function termPathPhrases(term: Pick<TermRecord, "labelEn" | "aliasesEn" | "slug">): string[][] {
  const phrases = [term.labelEn, term.slug.replace(/-/gu, " "), ...term.aliasesEn]
    .filter((text): text is string => Boolean(text))
    .map(words)
    .filter((phrase) => phrase.length > 0);
  const seen = new Set<string>();
  return phrases.filter((phrase) => !seen.has(phrase.join(" ")) && seen.add(phrase.join(" ")));
}

/**
 * Pages of the feed that look like they are about the term, best first. A page matches when every word of one phrase
 * appears among the words of its last path segment. The label outranks an alias, and a slug that is nothing but the
 * phrase outranks a longer one ("crop-yields" for crop yield over "crop-yields-and-land-use").
 */
export function rankTopicUrls(
  urls: readonly string[],
  term: Pick<TermRecord, "labelEn" | "aliasesEn" | "slug">,
  limit: number = TOPIC_SOURCE_DEFAULTS.perTopic,
): string[] {
  const phrases = termPathPhrases(term);
  const scored: Array<{ url: string; score: number }> = [];
  for (const url of urls) {
    let segment: string;
    try { segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? ""; } catch { continue; }
    const slugWords = words(segment.replace(/-/gu, " "));
    if (!slugWords.length) continue;
    let best = 0;
    phrases.forEach((phrase, index) => {
      if (!phrase.every((word) => slugWords.includes(word))) return;
      const exact = phrase.length === slugWords.length ? 1 : 0;
      const score = 10 - Math.min(index, 5) + exact * 3 + phrase.length - (slugWords.length - phrase.length) * 0.1;
      if (score > best) best = score;
    });
    if (best > 0) scored.push({ url, score: best });
  }
  return scored.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url)).slice(0, limit).map((entry) => entry.url);
}

export interface TopicSourceRun {
  topics: number;
  candidates: number;
  fetched: number;
  newSnapshots: number;
  unchanged: number;
  rejected: number;
  failed: number;
  perTopic: Record<string, string[]>;
}

/**
 * Fetches, for each term, up to `perTopic` more pages of the feed that are about it. A page already stored and not yet
 * due again is not fetched. Stops at `maxFetches`. Returns what it did; claims are extracted by the normal queue.
 */
export async function runLedgerTopicSources(
  deps: IngestDeps,
  feed: LedgerFeed,
  terms: ReadonlyArray<Pick<TermRecord, "slug" | "labelEn" | "aliasesEn">>,
  options: { perTopic?: number; maxFetches?: number; urls?: readonly string[] } = {},
): Promise<TopicSourceRun> {
  const perTopic = Math.max(1, options.perTopic ?? TOPIC_SOURCE_DEFAULTS.perTopic);
  const maxFetches = Math.max(1, options.maxFetches ?? TOPIC_SOURCE_DEFAULTS.maxFetches);
  const result: TopicSourceRun = { topics: terms.length, candidates: 0, fetched: 0, newSnapshots: 0, unchanged: 0, rejected: 0, failed: 0, perTopic: {} };
  const all = options.urls ? [...options.urls] : await discoverSitemapUrls(deps, feed);
  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const fetchedAlready = new Set<string>();

  for (const term of terms) {
    const ranked = rankTopicUrls(all, term, perTopic);
    result.perTopic[term.slug] = ranked;
    result.candidates += ranked.length;
    for (const url of ranked) {
      if (result.fetched >= maxFetches) return result;
      if (fetchedAlready.has(url)) continue; // one page serves every topic it matches
      fetchedAlready.add(url);
      const known = await deps.db.prepare("SELECT next_check_at AS nextCheckAt FROM encyclopedia_sources WHERE topic_id = ? AND normalized_url = ?")
        .bind(LEDGER_TOPIC_ID, url).first<{ nextCheckAt: number | null }>();
      if (known && known.nextCheckAt !== null && known.nextCheckAt > now) continue;
      result.fetched += 1;
      const outcome: PageOutcome = await processLedgerUrl(deps, feed, url);
      if (outcome.outcome === "new-snapshot") result.newSnapshots += 1;
      else if (outcome.outcome === "unchanged" || outcome.outcome === "skipped") result.unchanged += 1;
      else if (outcome.outcome === "rejected") result.rejected += 1;
      else result.failed += 1;
    }
  }
  return result;
}
