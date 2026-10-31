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

const [archiveArgument, ...restoreOptions] = process.argv.slice(2);
const keepState = restoreOptions.length === 1 && restoreOptions[0] === "--keep-state";
if (!archiveArgument || (restoreOptions.length && !keepState)) {
  console.error("Usage: npm run db:restore:local -- <logical-backup.tar.gz> [--keep-state]");
  process.exit(2);
}

const hubDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.resolve(hubDirectory, "../../node_modules/wrangler/bin/wrangler.js");
const archive = path.resolve(process.cwd(), archiveArgument);
if (!existsSync(archive) || !/^hub-\d{8}T\d{6}Z\.tar\.gz$/.test(path.basename(archive))) {
  console.error("A Hub logical backup archive is required.");
  process.exit(2);
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "hub-d1-restore-drill-"));
const extractDirectory = path.join(temporaryRoot, "extract");
const persistDirectory = path.join(temporaryRoot, "d1");
const dropTriggersSql = path.join(temporaryRoot, "drop-triggers.sql");
const restoreSql = path.join(temporaryRoot, "restore.sql");
const recreateTriggersSql = path.join(temporaryRoot, "recreate-triggers.sql");
const rebuildSearchSql = path.join(temporaryRoot, "rebuild-search.sql");
const verifySql = path.join(temporaryRoot, "verify.sql");
const verifyContentsSql = path.join(temporaryRoot, "verify-contents.sql");
let verified = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: hubDirectory,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const rawDiagnostic = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    const diagnostic = rawDiagnostic.length > 8000
      ? `${rawDiagnostic.slice(0, 4000)}\n…\n${rawDiagnostic.slice(-4000)}`
      : rawDiagnostic;
    throw new Error(`${command} failed (${result.status ?? "unknown"}): ${diagnostic}`);
  }
  return result.stdout;
}

function npx(args) {
  if (args[0] !== "wrangler") throw new Error("Only the local Wrangler CLI is supported");
  return run(process.execPath, [wranglerBin, ...args.slice(1)]);
}

function isolatedJson(sql) {
  const payload = JSON.parse(npx([
    "wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory,
    "--command", sql, "--json",
  ]));
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first?.success || !Array.isArray(first.results)) throw new Error("Isolated D1 query returned an invalid result");
  return first.results;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
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

try {
  run("tar", ["-xzf", archive, "-C", temporaryRoot]);
  const snapshotDirectory = readdirSync(temporaryRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.startsWith("hub-") && entry.name !== "extract")?.name;
  if (!snapshotDirectory) throw new Error("Backup archive has no snapshot directory");
  const root = path.join(temporaryRoot, snapshotDirectory);
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.format !== "jkamma-hub-d1-logical-v1" || !Array.isArray(manifest.tables)) {
    throw new Error("Unsupported Hub backup format");
  }
  if (!manifest.schema || manifest.schema.file !== "schema.json" || sha256(path.join(root, "schema.json")) !== manifest.schema.sha256) {
    throw new Error("Backup schema metadata is missing or corrupted");
  }

  for (const table of manifest.tables) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(table.name) || table.file !== `${table.name}.json`) {
      throw new Error("Backup manifest contains an unsafe table entry");
    }
    const file = path.join(root, table.file);
    if (sha256(file) !== table.sha256) throw new Error(`Checksum mismatch for ${table.name}`);
  }

  npx(["wrangler", "d1", "migrations", "apply", "HUB_DATABASE", "--local", "--persist-to", persistDirectory]);
  const isolatedSchemaRows = isolatedJson(`
    SELECT type, name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger', 'view') AND sql IS NOT NULL
    ORDER BY type, name
  `).map((row) => ({ type: String(row.type), name: String(row.name), sql: String(row.sql) }));
  const danglingTriggerReferences = findDanglingTriggerReferences({ entries: isolatedSchemaRows, fingerprint: "" });
  if (danglingTriggerReferences.length) {
    throw new Error(`Isolated migration schema has dangling trigger references: ${JSON.stringify(danglingTriggerReferences)}`);
  }
  const danglingForeignKeys = findDanglingForeignKeyReferences({ entries: isolatedSchemaRows, fingerprint: "" });
  if (danglingForeignKeys.length) {
    throw new Error(`Isolated migration schema has dangling foreign keys: ${JSON.stringify(danglingForeignKeys)}`);
  }
  const triggers = isolatedSchemaRows
    .filter((row) => row.type === "trigger")
    .map((row) => ({ name: row.name, sql: row.sql }));
  if (triggers.some((trigger) => !trigger.name || !trigger.sql)) throw new Error("Isolated D1 trigger snapshot is invalid");

  writeFileSync(
    dropTriggersSql,
    `${triggers.map((trigger) => `DROP TRIGGER IF EXISTS "${trigger.name.replaceAll('"', '""')}";`).join("\n")}\n`,
    { mode: 0o600 },
  );
  npx(["wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--file", dropTriggersSql]);

  const statements = ["PRAGMA foreign_keys = OFF;", "BEGIN TRANSACTION;", "PRAGMA defer_foreign_keys = ON;"];
  for (const table of [...manifest.tables].reverse()) {
    statements.push(`DELETE FROM "${table.name}";`);
  }
  for (const table of manifest.tables) {
    const rows = JSON.parse(readFileSync(path.join(root, table.file), "utf8"));
    if (!Array.isArray(rows) || rows.length !== table.rows) throw new Error(`Row count mismatch for ${table.name}`);
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0 || columns.some((column) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(column))) {
        throw new Error(`Unsafe row shape for ${table.name}`);
      }
      statements.push(`INSERT INTO "${table.name}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(",")});`);
    }
  }
  statements.push(
    "COMMIT;",
    "PRAGMA defer_foreign_keys = OFF;",
    "PRAGMA foreign_keys = ON;",
  );
  writeFileSync(restoreSql, `${statements.join("\n")}\n`, { mode: 0o600 });
  npx(["wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--file", restoreSql]);

  writeFileSync(
    recreateTriggersSql,
    `${triggers.map((trigger) => trigger.sql.replace(/;?\s*$/u, ";")).join("\n")}\n`,
    { mode: 0o600 },
  );
  try {
    npx(["wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--file", recreateTriggersSql]);
  } catch (error) {
    const restoredTriggerNames = new Set(isolatedJson("SELECT name FROM sqlite_master WHERE type = 'trigger'").map((row) => String(row.name)));
    const missingTriggerNames = triggers.map((trigger) => trigger.name).filter((name) => !restoredTriggerNames.has(name));
    throw new Error(`Trigger recreation failed; missing triggers: ${missingTriggerNames.slice(0, 20).join(", ")}`, { cause: error });
  }

  const searchIndexes = isolatedSchemaRows.filter((row) => row.type === "table"
    && /CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql)
    && /USING\s+fts5\s*\(/i.test(row.sql)
    && /\bcontent\s*=\s*'[^']+'/i.test(row.sql));
  if (searchIndexes.some((row) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(row.name))) {
    throw new Error("Unsupported search index name");
  }
  if (searchIndexes.length) {
    writeFileSync(rebuildSearchSql, searchIndexes.flatMap((row) => [
      `INSERT INTO "${row.name}" ("${row.name}") VALUES ('rebuild');`,
      `INSERT INTO "${row.name}" ("${row.name}", rank) VALUES ('integrity-check', 1);`,
    ]).join("\n") + "\n", { mode: 0o600 });
    npx(["wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--file", rebuildSearchSql]);
  }

  writeFileSync(
    verifySql,
    `${[
      ...manifest.tables.map((table) => `SELECT COUNT(*) AS count FROM "${table.name}";`),
      "PRAGMA foreign_key_check;",
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger';",
    ].join("\n")}\n`,
    { mode: 0o600 },
  );
  const verificationPayload = JSON.parse(npx([
    "wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory, "--file", verifySql, "--json",
  ]));
  if (!Array.isArray(verificationPayload) || verificationPayload.length !== manifest.tables.length + 2) {
    throw new Error("Restore verification omitted table results");
  }
  let restoredRows = 0;
  for (const [index, table] of manifest.tables.entries()) {
    const count = Number(verificationPayload[index]?.results?.[0]?.count);
    if (count !== table.rows) throw new Error(`Restored row count mismatch for ${table.name}`);
    restoredRows += count;
  }
  const foreignKeyFailures = verificationPayload[manifest.tables.length]?.results;
  if (!Array.isArray(foreignKeyFailures) || foreignKeyFailures.length !== 0) {
    throw new Error(`Restored database has ${Array.isArray(foreignKeyFailures) ? foreignKeyFailures.length : "unknown"} foreign key violations`);
  }
  const restoredTriggerCount = Number(verificationPayload[manifest.tables.length + 1]?.results?.[0]?.count);
  if (restoredTriggerCount !== triggers.length) throw new Error("Restored trigger count mismatch");
  writeFileSync(verifyContentsSql, manifest.tables.map((table) => `SELECT * FROM "${table.name}";`).join("\n") + "\n", { mode: 0o600 });
  const restoredContents = JSON.parse(npx([
    "wrangler", "d1", "execute", "HUB_DATABASE", "--local", "--persist-to", persistDirectory,
    "--file", verifyContentsSql, "--json",
  ]));
  if (!Array.isArray(restoredContents) || restoredContents.length !== manifest.tables.length) {
    throw new Error("Restore content verification omitted tables");
  }
  const canonicalRows = (rows) => rows.map((row) =>
    JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]))).sort();
  for (const [index, table] of manifest.tables.entries()) {
    const actual = restoredContents[index];
    if (!actual?.success || !Array.isArray(actual.results)) throw new Error(`Content query failed for ${table.name}`);
    const expectedRows = canonicalRows(JSON.parse(readFileSync(path.join(root, table.file), "utf8")));
    const actualRows = canonicalRows(actual.results);
    if (expectedRows.length !== actualRows.length || expectedRows.some((row, rowIndex) => row !== actualRows[rowIndex])) {
      throw new Error(`Restored content mismatch for ${table.name}`);
    }
  }
  const report = {
    format: manifest.format,
    archive,
    verifiedAt: new Date().toISOString(),
    tables: manifest.tables.length,
    rows: restoredRows,
    triggers: restoredTriggerCount,
    searchIndexesRebuilt: searchIndexes.length,
    searchIndexesVerified: searchIndexes.length,
    contentVerifiedTables: manifest.tables.length,
    foreignKeyViolations: 0,
    activeDatabaseModified: false,
    ...(keepState ? { retainedState: persistDirectory, retainedRoot: temporaryRoot } : {}),
  };
  const reportPath = `${archive}.verified.json`;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  chmodSync(reportPath, 0o600);
  verified = true;
  console.log(JSON.stringify(report));
} finally {
  if (!keepState || !verified) {
    if (path.dirname(path.resolve(temporaryRoot)) !== path.resolve(tmpdir())
      || !path.basename(temporaryRoot).startsWith("hub-d1-restore-drill-")) {
      throw new Error("Unexpected restore cleanup path");
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
