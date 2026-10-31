#!/usr/bin/env node
/*
 * Tag index backfill CLI (2026-10-29). Reads a SQLite file READ-ONLY and writes the statements to apply into a .sql file;
 * it never writes to the database. Apply the file with
 *   npx wrangler d1 execute HUB_DATABASE --local --file <out.sql>
 * (local state only; staging/production runs need the row counts reported first, per the D1 write budget rule).
 *
 *   node scripts/backfill-tag-index.mjs --source <copy.sqlite> --dry-run
 *   node scripts/backfill-tag-index.mjs --source <copy.sqlite> --out backfill-tags.sql
 *
 * Prints counts only, never tag text. Use a copy of the local state as --source, not the live files.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { runTagBackfill, statementToSql } from "./backfill-tag-index-core.mjs";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const source = argValue("--source");
const out = argValue("--out");
const dryRun = process.argv.includes("--dry-run");
if (!source || (!dryRun && !out)) {
  console.error("usage: backfill-tag-index.mjs --source <sqlite file> (--dry-run | --out <file.sql>) [--batch <n>]");
  process.exit(2);
}

const sqlite = new DatabaseSync(source, { readOnly: true });
const db = { all: (sql, params = []) => sqlite.prepare(sql).all(...params) };
if (out && !dryRun) writeFileSync(out, "-- tag index backfill; apply with wrangler d1 execute --local --file\n");
const counts = await runTagBackfill(db, {
  dryRun,
  batchSize: Number(argValue("--batch") ?? 500),
  onBatch: (statements) => appendFileSync(out, `${statements.map(statementToSql).join("\n")}\n`),
});
sqlite.close();
console.log(JSON.stringify({ dryRun, ...counts }));
