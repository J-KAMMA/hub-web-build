/*
 * Drains hubpedia_ledger_regen_queue (docs/hubpedia-ledger.md section 6).
 * Lane C supplies sanitize / saveTrimmedRevision / recompose; until they exist
 * this script refuses to run. Writes to the LOCAL D1 only, and only when the
 * owner has allowed D1 writes.
 */
import { openHubDatabase, reexecWithServerOnlyStub } from "./hubpedia-hub-db";

async function main() {
  if (reexecWithServerOnlyStub()) return;
  if (process.env.HUBPEDIA_LEDGER_ALLOW_D1_WRITE !== "1") {
    console.error("Refusing to write to D1: set HUBPEDIA_LEDGER_ALLOW_D1_WRITE=1 once D1 writes are allowed.");
    process.exitCode = 2;
    return;
  }
  const { processRegenQueue } = await import("../lib/encyclopedia/ledger/regenerate");
  let compose: Record<string, unknown>;
  try {
    compose = (await import("../lib/encyclopedia/ledger/compose" as string)) as Record<string, unknown>;
  } catch {
    console.error("Lane C modules (ledger/compose, sentence-check, store) are not present yet.");
    process.exitCode = 2;
    return;
  }
  const { db, objects, dispose } = await openHubDatabase();
  try {
    const deps = (compose.regenDeps as ((db: unknown, options?: unknown) => unknown) | undefined)?.(db, { objects });
    if (!deps) throw new Error("ledger/compose does not export regenDeps(db).");
    const outcomes = await processRegenQueue(db, deps as Parameters<typeof processRegenQueue>[1]);
    console.log(JSON.stringify(outcomes.map((o) => ({ articleId: o.articleId, action: o.action })), null, 2));
  } finally {
    await dispose();
  }
}

void main();
