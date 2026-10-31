import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hubDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceRoot = path.resolve(hubDirectory, "../..");
const wranglerCli = path.join(
  workspaceRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const backupRoot = path.resolve(
  process.env.HUB_PRODUCTION_BACKUP_DIRECTORY ??
    path.join(hubDirectory, "backups", "production"),
);
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const sqlFile = path.join(backupRoot, `hub-production-${stamp}.sql`);
const manifestFile = `${sqlFile}.manifest.json`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? hubDirectory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `${command} could not start: ${result.error.code ?? result.error.name}`,
    );
  }
  if (result.status !== 0) {
    const output =
      `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim();
    const detail = output.split(/\r?\n/u).filter(Boolean).at(-1);
    const error = new Error(
      `${command} failed (${result.status ?? "unknown"})${detail ? `: ${detail}` : ""}`,
    );
    error.commandOutput = output;
    throw error;
  }
  return result.stdout.trim();
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

if (process.env.HUB_PRODUCTION_BACKUP_CONFIRMED !== "true") {
  throw new Error(
    "Set HUB_PRODUCTION_BACKUP_CONFIRMED=true only after confirming the production D1 target and backup destination.",
  );
}

mkdirSync(backupRoot, { recursive: true, mode: 0o700 });

try {
  let exportUnavailableReason = "";
  try {
    run(process.execPath, [
      wranglerCli,
      "d1",
      "export",
      "HUB_DATABASE",
      "--remote",
      "--config",
      "wrangler.production.jsonc",
      "--output",
      `${sqlFile}.tmp`,
    ]);
  } catch (error) {
    if (
      !/cannot export databases with Virtual Tables \(fts5\)/iu.test(
        error.commandOutput ?? "",
      )
    ) {
      throw error;
    }
    exportUnavailableReason = "cloudflare-d1-export-does-not-support-fts5";
  }

  const migrations = readFileSync(
    path.join(
      hubDirectory,
      "migrations",
      "0151_distributed_video_manifests.sql",
    ),
  );
  const revision = run("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot });
  const commonManifest = {
    createdAt: new Date().toISOString(),
    sourceRevision: revision,
    schemaMigration: "0151_distributed_video_manifests.sql",
    schemaMigrationSha256: createHash("sha256")
      .update(migrations)
      .digest("hex"),
  };

  let manifest;
  if (exportUnavailableReason) {
    const recovery = JSON.parse(
      run(process.execPath, [
        wranglerCli,
        "d1",
        "time-travel",
        "info",
        "HUB_DATABASE",
        "--config",
        "wrangler.production.jsonc",
        "--json",
      ]),
    );
    if (!/^[-0-9a-f]{16,}$/iu.test(recovery.bookmark ?? "")) {
      throw new Error(
        "Cloudflare D1 Time Travel did not return a valid recovery bookmark",
      );
    }
    manifest = {
      format: "jkamma-hub-d1-production-time-travel-v1",
      ...commonManifest,
      exportUnavailableReason,
      recovery: {
        provider: "cloudflare-d1-time-travel",
        bookmark: recovery.bookmark,
      },
    };
  } else {
    if (statSync(`${sqlFile}.tmp`).size < 128) {
      throw new Error("Production D1 export is unexpectedly small");
    }
    chmodSync(`${sqlFile}.tmp`, 0o600);
    renameSync(`${sqlFile}.tmp`, sqlFile);
    manifest = {
      format: "jkamma-hub-d1-production-export-v1",
      ...commonManifest,
      export: {
        file: path.basename(sqlFile),
        bytes: statSync(sqlFile).size,
        sha256: sha256(sqlFile),
      },
    };
  }
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      manifest.export
        ? {
            backup: sqlFile,
            manifest: manifestFile,
            sha256: manifest.export.sha256,
          }
        : {
            recoveryBookmark: manifest.recovery.bookmark,
            manifest: manifestFile,
          },
    ),
  );
} catch (error) {
  rmSync(`${sqlFile}.tmp`, { force: true });
  rmSync(sqlFile, { force: true });
  rmSync(manifestFile, { force: true });
  throw error;
}
