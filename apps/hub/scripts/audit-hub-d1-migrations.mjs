import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MIGRATION_FILE = /^(\d{4})([a-z]?)_[a-z0-9_]+\.sql$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSql(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeFileText(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

export function createMigrationManifest(migrationDir) {
  const entries = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const match = MIGRATION_FILE.exec(name);
      if (!match) throw new Error(`migration_filename_invalid: ${name}`);
      return {
        name,
        prefix: match[1],
        sha256: sha256(normalizeFileText(readFileSync(resolve(migrationDir, name), "utf8"))),
      };
    });
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`migration_filename_duplicate: ${entry.name}`);
    names.add(entry.name);
  }
  const byPrefix = new Map();
  for (const entry of entries) {
    byPrefix.set(entry.prefix, [...(byPrefix.get(entry.prefix) ?? []), entry.name]);
  }
  const duplicatePrefixes = [...byPrefix.entries()]
    .filter(([, namesForPrefix]) => namesForPrefix.length > 1)
    .map(([prefix, namesForPrefix]) => ({ prefix, names: namesForPrefix }));
  return {
    entries,
    duplicatePrefixes,
    fingerprint: sha256(entries.map((entry) => `${entry.name}:${entry.sha256}`).join("\n")),
  };
}

function blocker(code, detail) {
  return { code, detail };
}

function schemaSummary(rows) {
  const normalized = rows
    .map((row) => ({
      type: String(row.type ?? row.kind ?? ""),
      name: String(row.name ?? row.key ?? ""),
      sql: normalizeSql(row.sql ?? row.value),
    }))
    .filter((row) => ["table", "index", "trigger", "view"].includes(row.type))
    .filter((row) => !row.name.startsWith("sqlite_"))
    .sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`));
  return {
    objectCount: normalized.length,
    fingerprint: sha256(normalized.map((row) => `${row.type}:${row.name}:${row.sql}`).join("\n")),
  };
}

export function auditMigrationSnapshot({
  runtimeManifest,
  ledgerRows,
  schemaRows = [],
  canonicalManifest = runtimeManifest,
}) {
  const blockers = [];
  const runtimeByName = new Map(runtimeManifest.entries.map((entry) => [entry.name, entry]));
  const canonicalByName = new Map(canonicalManifest.entries.map((entry) => [entry.name, entry]));
  const sortedLedger = [...ledgerRows].sort((left, right) => Number(left.id) - Number(right.id));
  const appliedNames = [];
  const seenAppliedNames = new Set();

  sortedLedger.forEach((row, index) => {
    const id = Number(row.id);
    const name = String(row.name ?? "");
    if (id !== index + 1) {
      blockers.push(blocker("migration_ledger_gap", { expectedId: index + 1, actualId: id }));
    }
    if (seenAppliedNames.has(name)) {
      blockers.push(blocker("migration_ledger_duplicate_name", { name }));
    }
    seenAppliedNames.add(name);
    appliedNames.push(name);
    if (!runtimeByName.has(name)) {
      blockers.push(blocker("applied_migration_missing_runtime_file", { name }));
    }
    if (!canonicalByName.has(name)) {
      blockers.push(blocker("applied_migration_missing_canonical_file", { name }));
    }
  });

  const pending = runtimeManifest.entries
    .map((entry) => entry.name)
    .filter((name) => !seenAppliedNames.has(name));
  const lastAppliedName = appliedNames.at(-1) ?? null;
  const retroactivePending = lastAppliedName
    ? pending.filter((name) => name.localeCompare(lastAppliedName) < 0)
    : [];
  if (retroactivePending.length) {
    blockers.push(blocker("retroactive_pending_migrations", { lastAppliedName, names: retroactivePending }));
  }

  const canonicalOnly = canonicalManifest.entries
    .map((entry) => entry.name)
    .filter((name) => !runtimeByName.has(name));
  const runtimeOnly = runtimeManifest.entries
    .map((entry) => entry.name)
    .filter((name) => !canonicalByName.has(name));
  const hashMismatches = runtimeManifest.entries
    .filter((entry) => canonicalByName.has(entry.name))
    .filter((entry) => canonicalByName.get(entry.name).sha256 !== entry.sha256)
    .map((entry) => entry.name);
  if (hashMismatches.length) {
    blockers.push(blocker("migration_content_mismatch", { names: hashMismatches }));
  }

  const schema = schemaSummary(schemaRows);
  const status = blockers.length ? "blocked" : pending.length || canonicalOnly.length || runtimeOnly.length ? "pending" : "ok";
  return {
    status,
    databaseChanged: false,
    appliedCount: appliedNames.length,
    lastAppliedName,
    pending,
    retroactivePending,
    canonicalOnly,
    runtimeOnly,
    hashMismatches,
    duplicatePrefixes: canonicalManifest.duplicatePrefixes,
    runtimeManifestFingerprint: runtimeManifest.fingerprint,
    canonicalManifestFingerprint: canonicalManifest.fingerprint,
    schema,
    blockers,
  };
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
    wranglerBin,
    "d1",
    "execute",
    binding,
    "--local",
    "--json",
    "--command",
    query,
  ], { cwd: projectDir, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler_read_failed: ${result.stderr.trim()}`);
  const payload = JSON.parse(result.stdout);
  const rows = payload?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error("wrangler_snapshot_invalid");
  return {
    ledgerRows: rows
      .filter((row) => row.kind === "migration")
      .map((row) => ({ id: Number(row.key), name: String(row.value) })),
    schemaRows: rows
      .filter((row) => row.kind !== "migration")
      .map((row) => ({ type: row.kind, name: row.key, sql: row.value })),
  };
}

export function runLocalAudit(projectDir, binding = "HUB_DATABASE") {
  const migrationDir = resolve(projectDir, "migrations");
  const runtimeManifest = createMigrationManifest(migrationDir);
  const snapshot = readLocalD1Snapshot(projectDir, binding);
  return auditMigrationSnapshot({ runtimeManifest, ...snapshot });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const projectDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const manifestOnly = process.argv.includes("--manifest-only");
    const manifest = createMigrationManifest(resolve(projectDir, "migrations"));
    const result = manifestOnly
      ? {
          status: "ok",
          databaseChanged: false,
          migrationCount: manifest.entries.length,
          manifestFingerprint: manifest.fingerprint,
          duplicatePrefixes: manifest.duplicatePrefixes,
        }
      : runLocalAudit(projectDir);
    console.log(JSON.stringify(result, null, 2));
    if (!manifestOnly && result.status === "blocked") process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
