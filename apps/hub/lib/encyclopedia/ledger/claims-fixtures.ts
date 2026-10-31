import type { D1Database } from "@cloudflare/workers-types";

import { sha256Hex } from "./dedupe";

/*
 * Test fixtures for Lane B. They stand in for Lane A's rows (migration 0291): the '_ledger' pool topic,
 * chunks with a content_hash, and evidence rows with superseded_at. Columns that 0291 adds are added here
 * only when the schema lacks them, so the same tests run before and after the merge.
 */

export async function ensureLaneAShape(db: D1Database) {
  const has = async (table: string, column: string) =>
    (await db.prepare(`SELECT 1 AS ok FROM pragma_table_info('${table}') WHERE name = ?`).bind(column).first()) !== null;
  if (!(await has("encyclopedia_source_chunks", "content_hash"))) await db.prepare("ALTER TABLE encyclopedia_source_chunks ADD COLUMN content_hash TEXT").run();
  if (!(await has("encyclopedia_claim_evidence", "superseded_at"))) await db.prepare("ALTER TABLE encyclopedia_claim_evidence ADD COLUMN superseded_at INTEGER").run();
  await db.prepare(
    `INSERT OR IGNORE INTO encyclopedia_topics (id, canonical_name, slug, topic_type, status, created_at, updated_at)
     VALUES ('pool-topic', '_ledger', '_ledger', 'ledger-pool', 'archived', 1, 1)`,
  ).run();
  // Once Lane A's migration exists it has already inserted the pool topic under its own id; tests use a fixed id.
  await db.prepare("UPDATE encyclopedia_topics SET id = 'pool-topic' WHERE slug = '_ledger' AND id <> 'pool-topic'").run();
}

export async function addSource(db: D1Database, id: string, url: string, title = "Fixture source") {
  await db.prepare(
    `INSERT INTO encyclopedia_sources (id, topic_id, url, normalized_url, title, source_type, license, reliability_tier, metadata, created_at, updated_at)
     VALUES (?, 'pool-topic', ?, ?, ?, 'web', 'CC-BY-4.0', 'official', ?, 1, 1)`,
  ).bind(id, url, url, title, JSON.stringify({ commercialReuse: { approved: true, reviewedAt: "2026-10-01T00:00:00Z", license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" } })).run();
}

export async function addChunks(db: D1Database, sourceId: string, texts: string[], retrievedAt = 10) {
  const snapshotId = `snap-${sourceId}-${retrievedAt}`;
  await db.prepare(
    `INSERT INTO encyclopedia_source_snapshots (id, source_id, retrieved_at, content_hash, created_at) VALUES (?, ?, ?, ?, 1)`,
  ).bind(snapshotId, sourceId, retrievedAt, sha256Hex(texts.join("\u0000"))).run();
  const ids: string[] = [];
  for (const [index, text] of texts.entries()) {
    const id = `chunk-${sourceId}-${retrievedAt}-${index}`;
    ids.push(id);
    await db.prepare(
      `INSERT INTO encyclopedia_source_chunks (id, snapshot_id, chunk_index, text_content, start_offset, end_offset, created_at, content_hash)
       VALUES (?, ?, ?, ?, 0, ?, 1, ?)`,
    ).bind(id, snapshotId, index, text, text.length, sha256Hex(text)).run();
  }
  return ids;
}

export const count = async (db: D1Database, sql: string, ...binds: unknown[]) =>
  Number((await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0);
