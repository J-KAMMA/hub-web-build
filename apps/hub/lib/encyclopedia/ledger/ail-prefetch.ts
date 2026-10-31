import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { FetchedPage } from "./ingest";

/*
 * Source prefetch for the AIL "hubpedia" worker project. The workers have no network: the Windows side fetches pages
 * through the ledger's own ingest (reviewed publishers only, Readability extraction, snapshot), writes a size-capped
 * text of each into the job's input, and keeps the full extracted page next to it. The importer then verifies the
 * worker's quotes against that stored page (same text, sha256 checked) instead of fetching again, unless the page is
 * older than PREFETCH_MAX_AGE_DAYS.
 *
 * Layout under <project>/tasks/<job>/ :
 *   sources/<QID>/<n>.txt    what the worker reads. First line: "#source url=<url> fetched_at=<ISO> sha256=<hex>", then a blank line, then the text.
 *   prefetch.json            { entries: PrefetchEntry[] }
 *   pages/<sha256>.json      the full extracted page ({ url, mimeType, title, language, text })
 */

export const PREFETCH_MAX_AGE_DAYS = 7;
export const SOURCE_TEXT_MAX_CHARS = 10_000;

export type PrefetchEntry = { url: string; finalUrl: string; fetchedAt: string; sha256: string };

export const sha256Of = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** The worker's copy: the start of the page, cut at a paragraph (or line, or sentence) boundary. */
export function truncateSourceText(text: string, max: number = SOURCE_TEXT_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  for (const separator of ["\n\n", "\n", "。", ". "]) {
    const at = head.lastIndexOf(separator);
    if (at > max * 0.6) return head.slice(0, at + separator.trimEnd().length);
  }
  return head;
}

export function sourceHeader(entry: Pick<PrefetchEntry, "finalUrl" | "fetchedAt" | "sha256">): string {
  return `#source url=${entry.finalUrl} fetched_at=${entry.fetchedAt} sha256=${entry.sha256}`;
}

export function renderSourceFile(entry: Pick<PrefetchEntry, "finalUrl" | "fetchedAt" | "sha256">, text: string): string {
  return `${sourceHeader(entry)}\n\n${truncateSourceText(text)}\n`;
}

export function parseSourceFile(content: string): { url: string; fetchedAt: string; sha256: string; body: string } | null {
  const newline = content.indexOf("\n");
  const first = newline < 0 ? content : content.slice(0, newline);
  const match = /^#source url=(\S+) fetched_at=(\S+) sha256=([0-9a-f]{64})$/u.exec(first.trim());
  if (!match) return null;
  return { url: match[1], fetchedAt: match[2], sha256: match[3], body: newline < 0 ? "" : content.slice(newline + 1).replace(/^\n/u, "") };
}

export function pageFileName(sha256: string) {
  return `${sha256}.json`;
}

/**
 * A fetch replacement for the importer: the stored page of `dir` for a URL, or null when there is none, its sha256 does not
 * match the index, or it is older than `maxAgeDays` (the importer then fetches the page again over the network).
 */
export function prefetchedFetcher(dir: string, options: { nowMs?: () => number; maxAgeDays?: number } = {}): (url: string) => FetchedPage | null {
  const indexFile = join(dir, "prefetch.json");
  const entries = existsSync(indexFile) ? ((JSON.parse(readFileSync(indexFile, "utf8")) as { entries?: PrefetchEntry[] }).entries ?? []) : [];
  const byUrl = new Map<string, PrefetchEntry>();
  for (const entry of entries) { byUrl.set(entry.url, entry); byUrl.set(entry.finalUrl, entry); }
  const now = options.nowMs ?? Date.now;
  const maxAgeMs = (options.maxAgeDays ?? PREFETCH_MAX_AGE_DAYS) * 86_400_000;
  return (url) => {
    const entry = byUrl.get(url);
    if (!entry) return null;
    const fetched = Date.parse(entry.fetchedAt);
    if (!Number.isFinite(fetched) || now() - fetched > maxAgeMs) return null;
    const file = join(dir, "pages", pageFileName(entry.sha256));
    if (!existsSync(file)) return null;
    let page: { url: string; mimeType: string; title: string | null; language: string | null; text: string };
    try { page = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
    if (typeof page.text !== "string" || sha256Of(page.text) !== entry.sha256) return null;
    return { url: entry.finalUrl, mimeType: page.mimeType, text: page.text, title: page.title ?? null, language: page.language ?? null, publishedAt: null, authors: [], headings: [] };
  };
}
