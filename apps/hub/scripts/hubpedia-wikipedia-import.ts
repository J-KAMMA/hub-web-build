import { basename, dirname, join, resolve } from "node:path";

import { dumpFileStreams, runWikipediaImport } from "../lib/encyclopedia/wikipedia/import";
import { readStreamOffsets, type Bz2Decoder } from "../lib/encyclopedia/wikipedia/dump";
import { openHubDatabase, throwawaySqlitePath } from "./hubpedia-hub-db";

/*
 * Japanese Wikipedia base layer import (docs/hubpedia-ledger.md, "Japanese Wikipedia base layer").
 *
 *   npx tsx scripts/hubpedia-wikipedia-import.ts --dump=<dir or .xml.bz2> --sqlite=<file> --objects=<dir>
 *       [--max-pages=N] [--min-chars=300] [--decoder=auto|system|js] [--prefetch=8]
 *
 * --dump is the directory that holds jawiki-latest-pages-articles-multistream.xml.bz2 and its -index.txt.bz2 (or
 * either file path). Writes only to the throwaway SQLite file and the object directory: never a Cloudflare D1 or
 * R2, and never the Wrangler state. The run resumes from the stream checkpoint kept in the SQLite file, and a
 * rerun rewrites nothing whose revision id is unchanged.
 */

const USAGE = "Usage: hubpedia-wikipedia-import --dump=<dir|file> --sqlite=<file> --objects=<dir> [--max-pages=N] [--min-chars=N] [--decoder=auto|system|js] [--prefetch=N]";
const option = (name: string) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  if (!throwawaySqlitePath()) throw new Error(`--sqlite is required: this script never writes a Wrangler D1. ${USAGE}`);
  if (!option("objects")) throw new Error(`--objects is required: this script never writes R2. ${USAGE}`);
  const dumpArgument = option("dump");
  if (!dumpArgument) throw new Error(USAGE);
  const { statSync } = await import("node:fs");
  const target = resolve(dumpArgument);
  const directory = statSync(target).isDirectory() ? target : dirname(target);
  const dumpFile = join(directory, "jawiki-latest-pages-articles-multistream.xml.bz2");
  const indexFile = join(directory, "jawiki-latest-pages-articles-multistream-index.txt.bz2");
  const decoder = (option("decoder") ?? "auto") as Bz2Decoder;
  if (!["auto", "system", "js"].includes(decoder)) throw new Error(USAGE);
  const maxPages = option("max-pages") ? Number(option("max-pages")) : undefined;
  if (maxPages !== undefined && (!Number.isSafeInteger(maxPages) || maxPages < 1)) throw new Error(USAGE);
  const minChars = option("min-chars") ? Number(option("min-chars")) : undefined;

  const started = Date.now();
  /* Streams hold about 100 pages each; read only as many offsets as a limited run needs. */
  const offsets = await readStreamOffsets(indexFile, maxPages ? Math.ceil(maxPages / 100) + 2 : Number.POSITIVE_INFINITY, decoder);
  /* A limited read returns one extra offset that only marks where the last wanted stream ends. */
  const lastEnd = maxPages ? offsets.pop() : undefined;
  console.log(`index: ${offsets.length} stream offsets in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const { db, objects, dispose } = await openHubDatabase();
  try {
    const dumpId = basename(directory);
    const resultStart = Date.now();
    const result = await runWikipediaImport({
      db, objects, dumpId, minChars, maxPages,
      streams: dumpFileStreams(dumpFile, offsets, { decoder, lastEnd, prefetch: option("prefetch") ? Number(option("prefetch")) : undefined }),
      log: (line) => console.log(`${new Date().toISOString()} ${line}`),
    });
    const seconds = (Date.now() - resultStart) / 1000;
    console.log(JSON.stringify({ ...result, seconds: Math.round(seconds * 10) / 10, pagesPerSecond: Math.round(result.pagesSeen / Math.max(seconds, 0.001)) }, null, 2));
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
