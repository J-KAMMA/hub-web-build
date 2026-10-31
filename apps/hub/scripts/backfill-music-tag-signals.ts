import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { inferMusicTagSignals } from "../lib/music-tagging";

/*
 * Re-reads the tags for the catalogue.
 *
 * It used to touch only works with no signals at all, which is right the
 * first time and useless afterwards: changing a rule leaves every existing
 * work exactly as it was. Adding the genre-led instrument rules would have
 * reached nothing without --all, the same shape of gap as an embedding that
 * never re-runs because the row did not change.
 *
 * --remote names the deployed database. It is spelled out rather than
 * defaulted, because writing 1,312 rows to the wrong one looks identical to
 * writing them to the right one.
 */
const remote = process.argv.includes("--remote");
const all = process.argv.includes("--all");
const database = remote ? (process.argv[process.argv.indexOf("--remote") + 1] ?? "") : "HUB_DATABASE";
if (remote && (!database || database.startsWith("--"))) {
  console.error("--remote needs the database name, for example --remote jkamma-hub-staging-db");
  process.exit(1);
}
const target = remote ? ["--remote"] : ["--local"];

function wrangler(args: string[]) {
  /*
   * wrangler's own entry point, run by node. Neither route through npx works
   * here: with shell:true the SQL argument is split on its own spaces and
   * wrangler answers `Unknown arguments: id,title,artist...`, and without it
   * node refuses to spawn npx.cmd at all (EINVAL — .cmd files need a shell
   * since the batch-argument fix). A plain .js file has neither problem and
   * receives the arguments exactly as written.
   */
  const cli = resolve(process.cwd(), "../../node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw new Error(`Could not run wrangler: ${result.error.message}`);
  if (result.status !== 0) {
    /* Both streams, and the command: "Wrangler failed." on its own said nothing. */
    throw new Error([`wrangler ${args.slice(0, 4).join(" ")} exited ${result.status}`, result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function results(output: string): Array<{ id: string; title: string; artist: string; description: string; genre: string; year: number; tagsJson: string }> {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler JSON output was not found.");
  const payload = JSON.parse(output.slice(start)) as Array<{ results?: Array<{ id: string; title: string; artist: string; description: string; genre: string; year: number; tagsJson: string }> }>;
  return payload.flatMap((entry) => entry.results ?? []);
}

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const rows = results(wrangler([
  "d1", "execute", database, ...target, "--json", "--command",
  `SELECT id,title,artist,description,genre,release_year year,tags_json tagsJson
   FROM music_works WHERE status='active'${all ? "" : " AND tag_signals_json='[]'"}`,
]));
const sql = rows.map((row) => {
  let existing: string[] = [];
  try { const parsed: unknown = JSON.parse(row.tagsJson); if (Array.isArray(parsed)) existing = parsed.filter((tag): tag is string => typeof tag === "string"); } catch { /* ignore invalid legacy tags */ }
  const signals = inferMusicTagSignals({ ...row, tags: existing });
  const tags = signals.filter((signal) => signal.confidence >= .5).map((signal) => signal.tag);
  return `UPDATE music_works SET tag_signals_json=${quote(JSON.stringify(signals))},tags_json=${quote(JSON.stringify([...new Set(tags)]))} WHERE id=${quote(row.id)};`;
}).join("\n");
if (sql) {
  const file = join(process.cwd(), ".backfill-music-tags.sql");
  writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });
  try { wrangler(["d1", "execute", database, ...target, "--file", file]); }
  finally { unlinkSync(file); }
}
console.log(JSON.stringify({ database, remote, all, updated: rows.length }));
