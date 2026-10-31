import { openLocalHubDatabase, reexecWithServerOnlyStub } from "./hubpedia-hub-db";

/*
 * Finds Hubpedia topic candidates in public Hub activity (DESIGN.md phase 2).
 *
 *   npm run hubpedia:hub-topics -- --dry-run
 *   npm run hubpedia:hub-topics -- --batch=25 --max=5
 *
 * One bounded step of the same scan the scheduled maintenance job runs:
 * keyset cursors persisted in D1, at most --batch ids per item kind, at most
 * --max new candidates. A candidate needs material from three or more authors
 * and two or more kinds of item; nothing else becomes one.
 *
 * --dry-run reads and reports. It writes no signals, no cursor and no
 * candidate. The report names item ids and counts only, never post text.
 *
 * It runs against the local development D1 (wrangler.dev.jsonc) and calls no
 * model. Drafting from a candidate is `hubpedia:factory -- --mode=hub-topics`.
 */

const USAGE = "Usage: npm run hubpedia:hub-topics -- [--dry-run] [--batch=1..100] [--max=0..20] [--kinds=post,thread,...]";

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const batch = Number(option("batch") ?? "25");
  const max = Number(option("max") ?? "5");
  if (!Number.isSafeInteger(batch) || batch < 1 || batch > 100) throw new Error(`--batch must be 1 to 100. ${USAGE}`);
  if (!Number.isSafeInteger(max) || max < 0 || max > 20) throw new Error(`--max must be 0 to 20. ${USAGE}`);

  const { HUB_EVIDENCE_KINDS } = await import("../lib/server/hubpedia-hub-evidence");
  const requested = option("kinds")?.split(",").map((kind) => kind.trim()).filter(Boolean);
  const kinds = requested?.map((kind) => {
    const known = HUB_EVIDENCE_KINDS.find((candidate) => candidate === kind);
    if (!known) throw new Error(`Unknown kind "${kind}". ${USAGE}`);
    return known;
  });

  const { databaseCoverageCheck, runHubTopicScan } = await import("../lib/server/hubpedia-hub-topics");
  const { getPublicReaderReadySeedArticles } = await import("../lib/encyclopedia/public-seed");
  const PUBLIC_READER_READY_SEED_ARTICLES = await getPublicReaderReadySeedArticles();
  const { db, dispose } = await openLocalHubDatabase();
  try {
    const catalog = new Set(PUBLIC_READER_READY_SEED_ARTICLES.flatMap((article) => [article.slug, article.title.normalize("NFKC").toLocaleLowerCase("ja")]));
    const inDatabase = databaseCoverageCheck(db);
    const result = await runHubTopicScan(db, {
      dryRun,
      batchPerKind: batch,
      maxCandidates: max,
      ...(kinds ? { kinds } : {}),
      isCovered: async (label) => catalog.has(label.normalize("NFKC").toLocaleLowerCase("ja")) || inDatabase(label),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await dispose();
  }
}

if (!reexecWithServerOnlyStub()) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
