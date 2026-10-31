import { openHubDatabase, reexecWithServerOnlyStub } from "./hubpedia-hub-db";

/*
 * Hubpedia ledger, stages S1 to S3: discover, snapshot and chunk sources
 * (docs/hubpedia-ledger.md section 2). No model is called.
 *
 *   npx tsx scripts/hubpedia-ledger-ingest.ts --dry-run
 *   npx tsx scripts/hubpedia-ledger-ingest.ts --feed=owid --limit=50
 *
 * --dry-run lists which feeds would run and why the others would not; it opens
 * no database and fetches nothing. A real run writes to the local development
 * D1 (wrangler.dev.jsonc) only. Running it is the owner's decision.
 *
 * --sqlite=<file> writes to a throwaway SQLite file (all migrations applied) instead; this is the only
 * target allowed while the owner's no-D1-writes rule stands. --urls fetches exactly those URLs through the
 * one --feed given (default owid); every URL still passes the feed's admission and the evidence policy.
 */

const USAGE = "Usage: hubpedia-ledger-ingest [--dry-run] [--feed=<id>[,<id>]] [--limit=1..500] [--urls=<url>[,<url>]] [--sqlite=<file>] [--objects=<dir>]";

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number(option("limit") ?? "50");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error(`--limit must be 1 to 500. ${USAGE}`);
  const { LEDGER_FEEDS, getLedgerFeed } = await import("../lib/encyclopedia/ledger/feeds");
  const { defaultIngestDeps, feedRunnable, runLedgerIngest } = await import("../lib/encyclopedia/ledger/ingest");
  const requested = option("feed")?.split(",").map((id) => id.trim()).filter(Boolean);
  const feeds = requested
    ? requested.map((id) => {
        const feed = getLedgerFeed(id);
        if (!feed) throw new Error(`Unknown feed "${id}". ${USAGE}`);
        return feed;
      })
    : LEDGER_FEEDS;

  if (dryRun) {
    console.log(JSON.stringify(feeds.map((feed) => ({ feed: feed.id, status: feed.status, ...feedRunnable(feed) })), null, 2));
    return;
  }
  const { db, objects, dispose } = await openHubDatabase();
  try {
    const urls = option("urls")?.split(",").map((url) => url.trim()).filter(Boolean);
    if (urls?.length) {
      if (feeds.length !== 1) throw new Error("--urls needs exactly one --feed.");
      const gate = feedRunnable(feeds[0]);
      if (!gate.ok) throw new Error(`Feed ${feeds[0].id} is not runnable: ${gate.reason}`);
      const { processLedgerUrl } = await import("../lib/encyclopedia/ledger/ingest");
      const deps = defaultIngestDeps(db, objects);
      const outcomes = [];
      for (const url of urls) outcomes.push({ url, ...(await processLedgerUrl(deps, feeds[0], url)) });
      console.log(JSON.stringify(outcomes, null, 2));
      return;
    }
    const runnable = feeds.filter((feed) => feedRunnable(feed).ok);
    const { timed } = await import("../lib/encyclopedia/ledger/stage-log");
    const outcome = await timed("ingest-run", () => runLedgerIngest(defaultIngestDeps(db, objects), runnable, { limit }));
    console.log(JSON.stringify(outcome, null, 2));
  } finally {
    await dispose();
  }
}

if (!reexecWithServerOnlyStub()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
