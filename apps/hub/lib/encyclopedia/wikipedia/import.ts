import type { D1Database } from "@cloudflare/workers-types";

import { sha256Text, type LedgerObjectStore } from "../ledger/object-store";
import { decompressBz2, parsePages, readStreamOffsets, type Bz2Decoder, type DumpPage } from "./dump";
import {
  DEFAULT_MIN_CHARS, WIKIPEDIA_LICENSE, WIKIPEDIA_LICENSE_URL, WIKIPEDIA_OBJECT_PREFIX, wikipediaHistoryUrl, wikipediaObjectKey, wikipediaPageUrl, wikipediaSlug,
} from "./constants";
import { CONVERTER_VERSION, isDisambiguationText, isRedirectText, leadSummary, wikitextToPlain } from "./wikitext";

/*
 * Importing the Japanese Wikipedia dump into the Hubpedia base layer (docs/hubpedia-ledger.md,
 * "Japanese Wikipedia base layer"). Body text goes to the object store, one catalog row per article to
 * hubpedia_wikipedia_articles. The run is resumable (a stream-offset checkpoint) and idempotent (an article is
 * rewritten only when its revision id or the converter version changed).
 */

export { DEFAULT_MIN_CHARS, WIKIPEDIA_LICENSE, WIKIPEDIA_LICENSE_URL, WIKIPEDIA_OBJECT_PREFIX, wikipediaHistoryUrl, wikipediaObjectKey, wikipediaPageUrl, wikipediaSlug };

export interface ImportCounters {
  pagesSeen: number;
  imported: number;
  unchanged: number;
  redirects: number;
  disambiguation: number;
  stubs: number;
  otherNamespace: number;
  bodyBytes: number;
}

export const emptyCounters = (): ImportCounters => ({ pagesSeen: 0, imported: 0, unchanged: 0, redirects: 0, disambiguation: 0, stubs: 0, otherNamespace: 0, bodyBytes: 0 });

export interface DumpStream { offset: number; xml: string }
export interface ImportDeps {
  db: D1Database;
  objects: LedgerObjectStore;
  dumpId: string;
  /** Yields streams in ascending offset order, starting at the first stream whose offset is >= `from`. */
  streams: (from: number) => AsyncIterable<DumpStream>;
  now?: () => string;
  minChars?: number;
  /** Stops after the stream in which this many pages have been seen (smoke tests). */
  maxPages?: number;
  log?: (line: string) => void;
}

type ExistingRow = { page_id: number; revision_id: number; converter_version: number };

function redirectTarget(page: DumpPage): string | null {
  if (page.redirectTitle) return page.redirectTitle.split("#")[0].trim() || null;
  if (!isRedirectText(page.text)) return null;
  return /\[\[([^\]|#]+)/u.exec(page.text)?.[1]?.trim() ?? null;
}

export async function runWikipediaImport(deps: ImportDeps): Promise<ImportCounters & { finished: boolean; resumedFrom: number }> {
  const now = deps.now ?? (() => new Date().toISOString());
  const minChars = deps.minChars ?? DEFAULT_MIN_CHARS;
  const log = deps.log ?? (() => undefined);
  const { db, objects, dumpId } = deps;

  const run = await db.prepare("SELECT next_offset, pages_seen, imported, unchanged, redirects, disambiguation, stubs, other_namespace, finished FROM hubpedia_wikipedia_import_runs WHERE dump_id=?").bind(dumpId)
    .first<{ next_offset: number; pages_seen: number; imported: number; unchanged: number; redirects: number; disambiguation: number; stubs: number; other_namespace: number; finished: number }>();
  const counters: ImportCounters = run
    ? { pagesSeen: run.pages_seen, imported: run.imported, unchanged: run.unchanged, redirects: run.redirects, disambiguation: run.disambiguation, stubs: run.stubs, otherNamespace: run.other_namespace, bodyBytes: 0 }
    : emptyCounters();
  const resumedFrom = run?.next_offset ?? 0;
  if (run?.finished) return { ...counters, finished: true, resumedFrom };
  const startedWith = counters.pagesSeen;
  let nextProgress = Math.floor(counters.pagesSeen / 1000) * 1000 + 1000;
  const seenThisRun = () => counters.pagesSeen - startedWith;

  let lastOffset = resumedFrom;
  let finished = true;
  for await (const stream of deps.streams(resumedFrom)) {
    const pages = parsePages(stream.xml);
    const candidates = pages.filter((page) => page.ns === 0 && !redirectTarget(page));
    const existing = new Map<number, ExistingRow>();
    if (candidates.length) {
      const rows = await db.prepare(`SELECT page_id, revision_id, converter_version FROM hubpedia_wikipedia_articles WHERE page_id IN (${candidates.map(() => "?").join(",")})`)
        .bind(...candidates.map((page) => page.pageId)).all<ExistingRow>();
      for (const row of rows.results) existing.set(row.page_id, row);
    }

    const statements: ReturnType<D1Database["prepare"]>[] = [];
    for (const page of pages) {
      counters.pagesSeen += 1;
      if (page.ns !== 0) { counters.otherNamespace += 1; continue; }
      const target = redirectTarget(page);
      if (target) {
        counters.redirects += 1;
        if (wikipediaSlug(target) !== wikipediaSlug(page.title)) {
          statements.push(db.prepare("INSERT INTO hubpedia_wikipedia_aliases (alias_slug, alias_title, target_slug) VALUES (?,?,?) ON CONFLICT(alias_slug) DO UPDATE SET alias_title=excluded.alias_title, target_slug=excluded.target_slug")
            .bind(wikipediaSlug(page.title), page.title, wikipediaSlug(target)));
        }
        continue;
      }
      if (isDisambiguationText(page.text)) { counters.disambiguation += 1; continue; }
      const known = existing.get(page.pageId);
      if (known && known.revision_id === page.revisionId && known.converter_version === CONVERTER_VERSION) { counters.unchanged += 1; continue; }
      const body = wikitextToPlain(page.text);
      if ([...body].length < minChars) { counters.stubs += 1; continue; }

      const key = wikipediaObjectKey(page.revisionId);
      const bytes = Buffer.byteLength(body, "utf8");
      const sha256 = sha256Text(body);
      /* The key is the revision id, so a changed converter rewrites the object. */
      if (!(await objects.has(key)) || (known && known.converter_version !== CONVERTER_VERSION)) await objects.put(key, body);
      counters.bodyBytes += bytes;
      statements.push(
        db.prepare("DELETE FROM hubpedia_wikipedia_articles WHERE slug=? AND page_id<>?").bind(wikipediaSlug(page.title), page.pageId),
        db.prepare(
          `INSERT INTO hubpedia_wikipedia_articles (page_id, slug, title, revision_id, revision_timestamp, body_object_key, body_sha256, body_bytes, summary, license, source_url, history_url, verification_status, converter_version, dump_id, imported_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'unverified', ?,?,?)
           ON CONFLICT(page_id) DO UPDATE SET slug=excluded.slug, title=excluded.title, revision_id=excluded.revision_id, revision_timestamp=excluded.revision_timestamp,
             body_object_key=excluded.body_object_key, body_sha256=excluded.body_sha256, body_bytes=excluded.body_bytes, summary=excluded.summary,
             source_url=excluded.source_url, history_url=excluded.history_url, converter_version=excluded.converter_version, dump_id=excluded.dump_id, imported_at=excluded.imported_at`,
        ).bind(page.pageId, wikipediaSlug(page.title), page.title, page.revisionId, page.timestamp, key, sha256, bytes, leadSummary(body), WIKIPEDIA_LICENSE,
          wikipediaPageUrl(page.title), wikipediaHistoryUrl(page.title), CONVERTER_VERSION, dumpId, now()),
      );
      counters.imported += 1;
    }

    lastOffset = stream.offset + 1;
    statements.push(db.prepare(
      `INSERT INTO hubpedia_wikipedia_import_runs (dump_id, next_offset, pages_seen, imported, unchanged, redirects, disambiguation, stubs, other_namespace, finished, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?)
       ON CONFLICT(dump_id) DO UPDATE SET next_offset=excluded.next_offset, pages_seen=excluded.pages_seen, imported=excluded.imported, unchanged=excluded.unchanged,
         redirects=excluded.redirects, disambiguation=excluded.disambiguation, stubs=excluded.stubs, other_namespace=excluded.other_namespace, updated_at=excluded.updated_at`,
    ).bind(dumpId, lastOffset, counters.pagesSeen, counters.imported, counters.unchanged, counters.redirects, counters.disambiguation, counters.stubs, counters.otherNamespace, now()));
    await db.batch(statements);

    while (counters.pagesSeen >= nextProgress) {
      log(`pages=${counters.pagesSeen} imported=${counters.imported} unchanged=${counters.unchanged} redirects=${counters.redirects} disambiguation=${counters.disambiguation} stubs=${counters.stubs} other=${counters.otherNamespace}`);
      nextProgress += 1000;
    }
    if (deps.maxPages !== undefined && seenThisRun() >= deps.maxPages) { finished = false; break; }
  }

  if (finished) await db.prepare("UPDATE hubpedia_wikipedia_import_runs SET finished=1, updated_at=? WHERE dump_id=?").bind(now(), dumpId).run();
  return { ...counters, finished, resumedFrom };
}

/** Streams of a real dump file: byte ranges from the index offsets, decompressed a few ahead of the consumer. */
export function dumpFileStreams(dumpFile: string, offsets: readonly number[], options: { decoder?: Bz2Decoder; prefetch?: number; lastEnd?: number } = {}) {
  const prefetch = Math.max(1, options.prefetch ?? 8);
  return async function* (from: number): AsyncGenerator<DumpStream> {
    const { open } = await import("node:fs/promises");
    const handle = await open(dumpFile, "r");
    const pending = new Map<number, Promise<DumpStream>>();
    try {
      const size = (await handle.stat()).size;
      const first = offsets.findIndex((offset) => offset >= from);
      if (first < 0) return;
      const load = async (index: number): Promise<DumpStream> => {
        const start = offsets[index];
        const end = index + 1 < offsets.length ? offsets[index + 1] : (options.lastEnd ?? size);
        const buffer = Buffer.alloc(end - start);
        await handle.read(buffer, 0, buffer.length, start);
        return { offset: start, xml: (await decompressBz2(buffer, options.decoder)).toString("utf8") };
      };
      for (let index = first; index < offsets.length; index += 1) {
        for (let ahead = index; ahead < Math.min(offsets.length, index + prefetch); ahead += 1) if (!pending.has(ahead)) pending.set(ahead, load(ahead));
        const stream = await pending.get(index)!;
        pending.delete(index);
        yield stream;
      }
    } finally {
      /* Streams read ahead and abandoned by an early stop must not fail loudly after the file is closed. */
      for (const abandoned of pending.values()) abandoned.catch(() => undefined);
      await Promise.allSettled([...pending.values()]);
      await handle.close();
    }
  };
}

export { readStreamOffsets };
