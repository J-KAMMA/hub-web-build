import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createMigrationManifest } from "./audit-hub-d1-migrations.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSql(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function schemaManifest(rows) {
  const entries = rows
    .map((row) => ({
      type: String(row.type ?? row.kind ?? ""),
      name: String(row.name ?? row.key ?? ""),
      sql: normalizeSql(row.sql ?? row.value),
    }))
    .filter((row) => ["table", "index", "trigger", "view"].includes(row.type))
    .filter((row) => !row.name.startsWith("sqlite_") && !row.name.startsWith("_cf_") && row.name !== "d1_migrations")
    .sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
  return {
    entries,
    fingerprint: sha256(entries.map((entry) => `${entry.type}:${entry.name}:${entry.sql}`).join("\n")),
  };
}

function triggerReferences(triggerSql) {
  const references = new Set();
  const commonTableExpressions = new Set(
    [...triggerSql.matchAll(/(?:\bWITH\b|,)\s*["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+AS\s*\(/giu)]
      .map((match) => match[1].toLowerCase()),
  );
  const header = /\bCREATE\s+TRIGGER\b[\s\S]*?\bON\s+["`\[]?([A-Za-z_][A-Za-z0-9_]*)/iu.exec(triggerSql);
  if (header) references.add(header[1]);
  const dml = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+(?:OR\s+\w+\s+)?|DELETE\s+FROM)\s+["`\[]?([A-Za-z_][A-Za-z0-9_]*)/giu;
  for (const match of triggerSql.matchAll(dml)) references.add(match[1]);
  const reads = /\b(?:FROM|JOIN)\s+["`\[]?([A-Za-z_][A-Za-z0-9_]*)/giu;
  for (const match of triggerSql.matchAll(reads)) references.add(match[1]);
  return [...references].filter((name) => !commonTableExpressions.has(name.toLowerCase()));
}

export function findDanglingTriggerReferences(schema) {
  const virtualRelations = new Set(["json_each", "json_tree"]);
  const relations = new Set(schema.entries
    .filter((entry) => entry.type === "table" || entry.type === "view")
    .map((entry) => entry.name.toLowerCase()));
  return schema.entries
    .filter((entry) => entry.type === "trigger")
    .flatMap((entry) => triggerReferences(entry.sql)
      .filter((name) => !relations.has(name.toLowerCase()) && !virtualRelations.has(name.toLowerCase()))
      .map((name) => ({ trigger: entry.name, missingRelation: name })))
    .sort((left, right) => `${left.trigger}:${left.missingRelation}`.localeCompare(`${right.trigger}:${right.missingRelation}`));
}

export function findDanglingForeignKeyReferences(schema) {
  const relations = new Set(schema.entries
    .filter((entry) => entry.type === "table" || entry.type === "view")
    .map((entry) => entry.name.toLowerCase()));
  const references = /\bREFERENCES\s+["`\[]?([A-Za-z_][A-Za-z0-9_]*)/giu;
  return schema.entries
    .filter((entry) => entry.type === "table")
    .flatMap((entry) => [...entry.sql.matchAll(references)]
      .map((match) => match[1])
      .filter((name) => !relations.has(name.toLowerCase()))
      .map((name) => ({ sourceTable: entry.name, missingRelation: name })))
    .sort((left, right) => `${left.sourceTable}:${left.missingRelation}`.localeCompare(`${right.sourceTable}:${right.missingRelation}`));
}

export function replayMigrationFiles(migrationDir, names) {
  const database = new DatabaseSync(":memory:");
  let failedMigration = null;
  let failure = null;
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    for (const name of names) {
      try {
        database.exec(readFileSync(resolve(migrationDir, name), "utf8"));
      } catch (error) {
        failedMigration = name;
        failure = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    const schema = schemaManifest(database.prepare(`
      SELECT type, name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'index', 'trigger', 'view')
      ORDER BY type, name
    `).all());
    return {
      status: failedMigration ? "blocked" : "ok",
      databaseChanged: false,
      replayedCount: failedMigration ? names.indexOf(failedMigration) : names.length,
      failedMigration,
      failure,
      schema,
      danglingTriggerReferences: findDanglingTriggerReferences(schema),
      danglingForeignKeyReferences: findDanglingForeignKeyReferences(schema),
    };
  } finally {
    database.close();
  }
}

function readLocalD1Snapshot(projectDir, binding) {
  const wranglerBin = resolve(projectDir, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const query = `
    SELECT 'migration' AS kind, CAST(id AS TEXT) AS key, name AS value
      FROM d1_migrations
    UNION ALL
    SELECT type AS kind, name AS key, COALESCE(sql, '') AS value
      FROM sqlite_master
     WHERE type IN ('table', 'index', 'trigger', 'view')
    ORDER BY kind, key
  `;
  const result = spawnSync(process.execPath, [
    wranglerBin, "d1", "execute", binding, "--local", "--json", "--command", query,
  ], { cwd: projectDir, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler_read_failed: ${result.stderr.trim()}`);
  const payload = JSON.parse(result.stdout);
  const rows = payload?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("wrangler_snapshot_invalid");
  return {
    ledgerRows: rows.filter((row) => row.kind === "migration")
      .map((row) => ({ id: Number(row.key), name: String(row.value) }))
      .sort((left, right) => left.id - right.id),
    schemaRows: rows.filter((row) => row.kind !== "migration")
      .map((row) => ({ type: row.kind, name: row.key, sql: row.value })),
  };
}

export function compareSchemas(activeSchema, replaySchema) {
  const active = new Map(activeSchema.entries.map((entry) => [`${entry.type}:${entry.name}`, entry.sql]));
  const replay = new Map(replaySchema.entries.map((entry) => [`${entry.type}:${entry.name}`, entry.sql]));
  return {
    activeOnly: [...active.keys()].filter((key) => !replay.has(key)).sort(),
    replayOnly: [...replay.keys()].filter((key) => !active.has(key)).sort(),
    definitionMismatches: [...active.keys()]
      .filter((key) => replay.has(key) && replay.get(key) !== active.get(key))
      .sort(),
  };
}

export function verifyLocalMigrationReplay(projectDir, binding = "HUB_DATABASE", { all = false } = {}) {
  const migrationDir = resolve(projectDir, "migrations");
  const snapshot = readLocalD1Snapshot(projectDir, binding);
  const names = all
    ? createMigrationManifest(migrationDir).entries.map((entry) => entry.name)
    : snapshot.ledgerRows.map((row) => row.name);
  const replay = replayMigrationFiles(migrationDir, names);
  const activeSchema = schemaManifest(snapshot.schemaRows);
  const comparison = compareSchemas(activeSchema, replay.schema);
  const blockers = [];
  if (replay.failedMigration) blockers.push({ code: "migration_replay_failed", detail: { name: replay.failedMigration, failure: replay.failure } });
  if (replay.danglingTriggerReferences.length) blockers.push({ code: "dangling_trigger_reference", detail: replay.danglingTriggerReferences });
  if (replay.danglingForeignKeyReferences.length) blockers.push({ code: "dangling_foreign_key_reference", detail: replay.danglingForeignKeyReferences });
  const activeDanglingForeignKeyReferences = findDanglingForeignKeyReferences(activeSchema);
  if (!all && activeDanglingForeignKeyReferences.length) {
    blockers.push({ code: "active_dangling_foreign_key_reference", detail: activeDanglingForeignKeyReferences });
  }
  if (!all && (comparison.activeOnly.length || comparison.replayOnly.length || comparison.definitionMismatches.length)) {
    blockers.push({ code: "active_schema_replay_mismatch", detail: comparison });
  }
  return {
    status: blockers.length ? "blocked" : "ok",
    databaseChanged: false,
    mode: all ? "all-canonical" : "applied-ledger",
    requestedCount: names.length,
    replayedCount: replay.replayedCount,
    activeSchema: { objectCount: activeSchema.entries.length, fingerprint: activeSchema.fingerprint },
    replaySchema: { objectCount: replay.schema.entries.length, fingerprint: replay.schema.fingerprint },
    ...comparison,
    danglingTriggerReferences: replay.danglingTriggerReferences,
    danglingForeignKeyReferences: replay.danglingForeignKeyReferences,
    activeDanglingForeignKeyReferences,
    blockers,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const projectDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const result = verifyLocalMigrationReplay(projectDir, "HUB_DATABASE", { all: process.argv.includes("--all") });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "blocked") process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
