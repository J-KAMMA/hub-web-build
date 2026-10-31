/*
 * Seed import (docs/hubpedia-ledger.md section 7). Default is a dry run that
 * only reads and prints counts. --write needs HUBPEDIA_LEDGER_ALLOW_D1_WRITE=1.
 * The three owner decisions are not selectable here; seeds are never changed.
 */
import type { ChunkLocator } from "../lib/encyclopedia/ledger/object-store";
import { openHubDatabase, reexecWithServerOnlyStub } from "./hubpedia-hub-db";

async function main() {
  if (reexecWithServerOnlyStub()) return;
  const write = process.argv.includes("--write");
  if (write && process.env.HUBPEDIA_LEDGER_ALLOW_D1_WRITE !== "1") {
    console.error("Refusing to write to D1: set HUBPEDIA_LEDGER_ALLOW_D1_WRITE=1 once D1 writes are allowed.");
    process.exitCode = 2;
    return;
  }
  const { chunkLocatorColumns, SnapshotReader } = await import("../lib/encyclopedia/ledger/object-store");
  const { planSeedImport, writeSeedImport } = await import("../lib/encyclopedia/ledger/import-seed");
  const { SOURCED_FACTORY_RECORDS } = await import("../lib/encyclopedia/seed/sourced-factory-manifest.generated");
  const { db, objects, dispose } = await openHubDatabase();
  try {
    const topic = await db.prepare("SELECT id FROM encyclopedia_topics WHERE slug = '_ledger'").first<{ id: string }>();
    if (!topic) throw new Error("Ledger pool topic _ledger is missing (migration 0291).");
    const plan = await planSeedImport(SOURCED_FACTORY_RECORDS as never, {
      chunksForSource: async (url) => {
        const rows = await db.prepare(`SELECT c.id AS id, ${chunkLocatorColumns("c", "s")}
          FROM encyclopedia_sources src
          JOIN encyclopedia_source_snapshots s ON s.id = (SELECT id FROM encyclopedia_source_snapshots WHERE source_id = src.id ORDER BY retrieved_at DESC LIMIT 1)
          JOIN encyclopedia_source_chunks c ON c.snapshot_id = s.id
          WHERE src.topic_id = ? AND (src.url = ? OR src.normalized_url = ?)`).bind(topic.id, url, url).all<{ id: string } & ChunkLocator>();
        const reader = new SnapshotReader(objects);
        const chunks = [];
        for (const r of rows.results ?? []) chunks.push({ id: r.id, sourceUrl: url, textContent: await reader.chunkText(r) });
        return chunks;
      },
    });
    console.log(JSON.stringify({ claims: plan.claims.length, droppedClaims: plan.droppedClaims, droppedEvidence: plan.droppedEvidence, skippedSources: plan.skippedSources.length }));
    if (write) console.log(JSON.stringify(await writeSeedImport(db, plan, { ledgerTopicId: topic.id })));
  } finally {
    await dispose();
  }
}

void main();
