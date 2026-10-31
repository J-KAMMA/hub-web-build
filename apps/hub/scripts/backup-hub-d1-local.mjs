import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hubDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.resolve(hubDirectory, "../../node_modules/wrangler/bin/wrangler.js");
const sourceArgs = [];
const supplied = new Set();
for (let index = 2; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!["--persist-to", "--config"].includes(option) || !value || value.startsWith("--") || supplied.has(option)) {
    throw new Error("Expected unique --persist-to <existing directory> and/or --config <existing file> options");
  }
  const resolved = realpathSync(path.resolve(value));
  const stat = statSync(resolved);
  if (option === "--persist-to" ? !stat.isDirectory() : !stat.isFile()) throw new Error("Invalid backup source path type");
  supplied.add(option);
  sourceArgs.push(option, resolved);
}
const backupRoot = path.resolve(process.env.HUB_BACKUP_DIRECTORY ?? path.join(hubDirectory, "backups"));
const stampDigits = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const stamp = `${stampDigits.slice(0, 8)}T${stampDigits.slice(8)}Z`;
const finalArchive = path.join(backupRoot, `hub-${stamp}.tar.gz`);
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "hub-d1-backup-"));
const snapshotName = `hub-${stamp}`;
const snapshotDirectory = path.join(temporaryRoot, snapshotName);

function wranglerJson(sql) {
  const result = spawnSync(
    process.execPath,
    [wranglerBin, "d1", "execute", "HUB_DATABASE", "--local", ...sourceArgs, "--command", sql, "--json"],
    { cwd: hubDirectory, encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`D1 backup query failed (${result.status ?? "unknown"})`);
  const payload = JSON.parse(result.stdout);
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (!first?.success || !Array.isArray(first.results)) throw new Error("D1 backup query returned an invalid result");
  return first.results;
}

function wranglerJsonFile(file) {
  const result = spawnSync(
    process.execPath,
    [wranglerBin, "d1", "execute", "HUB_DATABASE", "--local", ...sourceArgs, "--file", file, "--json"],
    { cwd: hubDirectory, encoding: "utf8", windowsHide: true, maxBuffer: 512 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`D1 backup export failed (${result.status ?? "unknown"})`);
  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload) || payload.some((entry) => !entry?.success || !Array.isArray(entry.results))) {
    throw new Error("D1 backup export returned an invalid result");
  }
  return payload.map((entry) => entry.results);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function run(command, args, cwd = hubDirectory) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? "unknown"})`);
}

try {
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  mkdirSync(snapshotDirectory, { mode: 0o700 });
  const tables = wranglerJson(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
      AND name NOT LIKE 'd1_%'
      AND name NOT LIKE '%_fts%'
      AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'
    ORDER BY name
  `).map((row) => String(row.name)).filter(Boolean);
  if (tables.length === 0) throw new Error("No application tables were found");
  const queryFile = path.join(temporaryRoot, "backup-queries.sql");
  writeFileSync(
    queryFile,
    `${tables.map((table) => `SELECT * FROM "${table.replaceAll('"', '""')}";`).join("\n")}\n`,
    { mode: 0o600 },
  );
  const tableRows = wranglerJsonFile(queryFile);
  if (tableRows.length !== tables.length) throw new Error("D1 backup export omitted a table result");
  const schema = wranglerJson(`
    SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_cf_%'
      AND name NOT LIKE 'd1_%'
    ORDER BY type, name
  `);
  const schemaFile = path.join(snapshotDirectory, "schema.json");
  writeFileSync(schemaFile, `${JSON.stringify(schema)}\n`, { mode: 0o600 });

  const manifest = {
    format: "jkamma-hub-d1-logical-v1",
    createdAt: new Date().toISOString(),
    environment: process.env.HUB_DEPLOYMENT_ENVIRONMENT ?? "development",
    schema: { file: "schema.json", objects: schema.length, sha256: sha256(schemaFile) },
    tables: [],
  };
  for (const [index, table] of tables.entries()) {
    const rows = tableRows[index];
    const fileName = `${table}.json`;
    const file = path.join(snapshotDirectory, fileName);
    writeFileSync(file, `${JSON.stringify(rows)}\n`, { mode: 0o600 });
    manifest.tables.push({ name: table, file: fileName, rows: rows.length, sha256: sha256(file) });
  }
  writeFileSync(path.join(snapshotDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  run("tar", ["-C", temporaryRoot, "-czf", `${finalArchive}.tmp`, snapshotName]);
  chmodSync(`${finalArchive}.tmp`, 0o600);
  renameSync(`${finalArchive}.tmp`, finalArchive);
  console.log(JSON.stringify({ backup: finalArchive, tables: manifest.tables.length, rows: manifest.tables.reduce((sum, table) => sum + table.rows, 0) }));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
