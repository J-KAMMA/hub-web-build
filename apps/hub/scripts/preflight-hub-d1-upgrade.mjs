import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  findDanglingForeignKeyReferences,
  findDanglingTriggerReferences,
} from "./verify-hub-d1-migration-replay.mjs";

const FTS_SHADOW_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Backup contains a non-finite number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function classifySchemaObjects(schemaRows) {
  const virtualTables = schemaRows.filter((row) => row.type === "table" && /^\s*CREATE\s+VIRTUAL\s+TABLE\b/iu.test(row.sql));
  const shadowNames = new Set(virtualTables.flatMap((row) => FTS_SHADOW_SUFFIXES.map((suffix) => `${row.name}${suffix}`)));
  return {
    tables: schemaRows.filter((row) => row.type === "table" && !/^\s*CREATE\s+VIRTUAL\s+TABLE\b/iu.test(row.sql) && !shadowNames.has(row.name)),
    virtualTables,
    indexes: schemaRows.filter((row) => row.type === "index"),
    triggers: schemaRows.filter((row) => row.type === "trigger"),
    views: schemaRows.filter((row) => row.type === "view"),
    skippedShadowTables: [...shadowNames].filter((name) => schemaRows.some((row) => row.type === "table" && row.name === name)).sort(),
  };
}

export function buildActiveCloneSql({ schemaRows, tables, ledgerRows, ledgerTableSql }) {
  const classified = classifySchemaObjects(schemaRows);
  const statements = ["PRAGMA foreign_keys = OFF;", "BEGIN TRANSACTION;", "PRAGMA defer_foreign_keys = ON;"];
  for (const row of [...classified.tables, ...classified.virtualTables]) statements.push(`${row.sql.replace(/;?\s*$/u, ";")}`);
  statements.push(`${ledgerTableSql.replace(/;?\s*$/u, ";")}`);
  for (const table of tables) {
    for (const row of table.rows) {
      const columns = Object.keys(row);
      if (!columns.length || columns.some((column) => !/^[A-Za-z][A-Za-z0-9_]*$/u.test(column))) {
        throw new Error(`Unsafe row shape for ${table.name}`);
      }
      statements.push(`INSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(",")});`);
    }
  }
  for (const row of [...classified.indexes, ...classified.triggers, ...classified.views]) statements.push(`${row.sql.replace(/;?\s*$/u, ";")}`);
  for (const row of ledgerRows) {
    statements.push(`INSERT INTO d1_migrations(id,name) VALUES (${Number(row.id)},${sqlLiteral(row.name)});`);
  }
  statements.push("COMMIT;", "PRAGMA defer_foreign_keys = OFF;", "PRAGMA foreign_keys = ON;");
  return { sql: `${statements.join("\n")}\n`, classified };
}

function run(command, args, cwd, { maxBuffer = 512 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer });
  if (result.status !== 0) {
    const diagnostic = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    throw new Error(`${command} failed (${result.status ?? "unknown"}): ${diagnostic.slice(-12000)}`);
  }
  return result.stdout;
}

function npx(hubDirectory, args) {
  return run(process.platform === "win32" ? "npx.cmd" : "npx", args, hubDirectory);
}

function wranglerJson(hubDirectory, args) {
  const payload = JSON.parse(npx(hubDirectory, [...args, "--json"]));
  return Array.isArray(payload) ? payload : [payload];
}

function readActiveSnapshot(hubDirectory) {
  const payload = wranglerJson(hubDirectory, [
    "wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--command",
    "SELECT id,name FROM d1_migrations ORDER BY id; SELECT sql FROM sqlite_master WHERE type='table' AND name='d1_migrations'",
  ]);
  const ledgerRows = payload[0]?.results;
  const ledgerTableSql = payload[1]?.results?.[0]?.sql;
  if (!Array.isArray(ledgerRows) || typeof ledgerTableSql !== "string") throw new Error("Active migration ledger snapshot is invalid");
  return { ledgerRows, ledgerTableSql };
}

function loadArchive(archive, temporaryRoot) {
  run("tar", ["-xzf", archive, "-C", temporaryRoot], process.cwd());
  const snapshotName = readdirSync(temporaryRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.startsWith("hub-"))?.name;
  if (!snapshotName) throw new Error("Backup archive has no snapshot directory");
  const root = path.join(temporaryRoot, snapshotName);
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.format !== "jkamma-hub-d1-logical-v1" || !Array.isArray(manifest.tables)) throw new Error("Unsupported Hub backup format");
  if (!manifest.schema || sha256(path.join(root, manifest.schema.file)) !== manifest.schema.sha256) throw new Error("Backup schema checksum mismatch");
  const schemaRows = JSON.parse(readFileSync(path.join(root, manifest.schema.file), "utf8"));
  const tables = manifest.tables.map((table) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(table.name) || table.file !== `${table.name}.json`) throw new Error("Unsafe backup table entry");
    const file = path.join(root, table.file);
    if (sha256(file) !== table.sha256) throw new Error(`Checksum mismatch for ${table.name}`);
    const rows = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(rows) || rows.length !== table.rows) throw new Error(`Row count mismatch for ${table.name}`);
    return { name: table.name, rows };
  });
  return { manifest, schemaRows, tables };
}

function isolatedJson(hubDirectory, persistDirectory, sql) {
  const payload = wranglerJson(hubDirectory, [
    "wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--command", sql,
  ]);
  return payload[0]?.results;
}

export function runUpgradePreflight(hubDirectory, archive) {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "hub-d1-upgrade-preflight-"));
  const persistDirectory = path.join(temporaryRoot, "d1");
  const cloneSql = path.join(temporaryRoot, "active-clone.sql");
  const countSql = path.join(temporaryRoot, "verify-counts.sql");
  try {
    const { manifest, schemaRows, tables } = loadArchive(archive, temporaryRoot);
    const active = readActiveSnapshot(hubDirectory);
    const { sql, classified } = buildActiveCloneSql({ schemaRows, tables, ledgerRows: active.ledgerRows, ledgerTableSql: active.ledgerTableSql });
    writeFileSync(cloneSql, sql, { mode: 0o600 });
    npx(hubDirectory, ["wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--file", cloneSql]);

    const beforeLedger = isolatedJson(hubDirectory, persistDirectory, "SELECT id,name FROM d1_migrations ORDER BY id");
    if (!Array.isArray(beforeLedger) || beforeLedger.length !== active.ledgerRows.length) throw new Error("Isolated ledger does not match active ledger count");
    npx(hubDirectory, ["wrangler", "d1", "migrations", "apply", "HUB_DATABASE", "--local", "--persist-to", persistDirectory]);

    writeFileSync(countSql, `${tables.map((table) => `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)};`).join("\n")}\n`, { mode: 0o600 });
    const countPayload = wranglerJson(hubDirectory, [
      "wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--file", countSql,
    ]);
    if (countPayload.length !== tables.length) throw new Error("Post-upgrade row count verification is incomplete");
    for (const [index, table] of tables.entries()) {
      const count = Number(countPayload[index]?.results?.[0]?.count);
      if (count !== table.rows.length) throw new Error(`Post-upgrade row count mismatch for ${table.name}: ${count} != ${table.rows.length}`);
    }

    const afterLedger = isolatedJson(hubDirectory, persistDirectory, "SELECT id,name FROM d1_migrations ORDER BY id");
    const schemaAfter = isolatedJson(hubDirectory, persistDirectory, "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND sql IS NOT NULL ORDER BY type,name");
    const foreignKeyFailures = isolatedJson(hubDirectory, persistDirectory, "PRAGMA foreign_key_check");
    if (!Array.isArray(afterLedger) || !Array.isArray(schemaAfter) || !Array.isArray(foreignKeyFailures)) throw new Error("Post-upgrade verification query failed");
    const schemaManifest = { entries: schemaAfter.map((row) => ({ type: String(row.type), name: String(row.name), sql: String(row.sql) })), fingerprint: "" };
    const danglingTriggers = findDanglingTriggerReferences(schemaManifest);
    const danglingForeignKeys = findDanglingForeignKeyReferences(schemaManifest);
    if (foreignKeyFailures.length || danglingTriggers.length || danglingForeignKeys.length) {
      throw new Error(`Post-upgrade integrity failed: ${JSON.stringify({ foreignKeyFailures: foreignKeyFailures.length, danglingTriggers, danglingForeignKeys })}`);
    }
    return {
      status: "passed",
      activeDatabaseModified: false,
      archive,
      backupTables: manifest.tables.length,
      backupRows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
      ledgerBefore: beforeLedger.length,
      ledgerAfter: afterLedger.length,
      appliedMigrations: afterLedger.slice(beforeLedger.length).map((row) => String(row.name)),
      preservedTables: tables.length,
      preservedRows: tables.reduce((sum, table) => sum + table.rows.length, 0),
      triggersAfter: schemaAfter.filter((row) => row.type === "trigger").length,
      foreignKeyViolations: 0,
      danglingTriggerReferences: 0,
      danglingForeignKeyReferences: 0,
      skippedFtsShadowTables: classified.skippedShadowTables.length,
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const [archiveArgument] = process.argv.slice(2);
    if (!archiveArgument) throw new Error("Usage: npm run db:upgrade:preflight -- <logical-backup.tar.gz>");
    const hubDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const archive = path.resolve(process.cwd(), archiveArgument);
    if (!existsSync(archive)) throw new Error("Backup archive does not exist");
    const report = runUpgradePreflight(hubDirectory, archive);
    const reportPath = `${archive}.upgrade-preflight.json`;
    writeFileSync(reportPath, `${JSON.stringify({ ...report, verifiedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(reportPath, 0o600);
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
