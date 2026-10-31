import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const MAX_SECONDS = 15 * 60;
const BATCH_SIZE = 50;

function runWrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Wrangler failed.");
  return result.stdout;
}

function parseWranglerJson(output) {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler did not return JSON.");
  return JSON.parse(output.slice(start));
}

function readDevVar(name) {
  const content = readFileSync(join(process.cwd(), ".dev.vars"), "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/u.exec(line.trim());
    if (!match || match[1] !== name) continue;
    return match[2].trim().replace(/^(['"])(.*)\1$/u, "$2");
  }
  return "";
}

function youtubeVideoId(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    const id = url.searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
  } catch {
    return null;
  }
}

function durationSeconds(value) {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(value ?? "");
  if (!match) return null;
  return Number(match[1] ?? 0) * 86_400
    + Number(match[2] ?? 0) * 3_600
    + Number(match[3] ?? 0) * 60
    + Number(match[4] ?? 0);
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const apiKey = readDevVar("YOUTUBE_DATA_API_KEY");
if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY is not configured.");

const query = `SELECT l.id AS link_id, l.music_work_id, l.source_url, w.title, w.artist
  FROM music_service_links l
  JOIN music_works w ON w.id = l.music_work_id
  WHERE l.provider = 'youtube' AND w.status = 'active'
  ORDER BY l.music_work_id`;
const queryResult = parseWranglerJson(runWrangler([
  "d1", "execute", "HUB_DATABASE", "--local", "--command", query, "--json",
]));
const rows = queryResult.flatMap((entry) => entry.results ?? []);
const byVideoId = new Map();
for (const row of rows) {
  const videoId = youtubeVideoId(row.source_url);
  if (!videoId) continue;
  const values = byVideoId.get(videoId) ?? [];
  values.push(row);
  byVideoId.set(videoId, values);
}

const videoIds = [...byVideoId.keys()];
const longRows = [];
for (let offset = 0; offset < videoIds.length; offset += BATCH_SIZE) {
  const ids = videoIds.slice(offset, offset + BATCH_SIZE);
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "contentDetails");
  endpoint.searchParams.set("id", ids.join(","));
  endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`YouTube API request failed with ${response.status}.`);
  const payload = await response.json();
  for (const item of payload.items ?? []) {
    const seconds = durationSeconds(item.contentDetails?.duration);
    if (seconds === null || seconds <= MAX_SECONDS) continue;
    for (const row of byVideoId.get(item.id) ?? []) longRows.push({ ...row, seconds });
  }
}

if (!longRows.length) {
  console.log(JSON.stringify({ checked: rows.length, removed: 0 }));
  process.exit(0);
}

const linkIds = [...new Set(longRows.map((row) => row.link_id))];
const workIds = [...new Set(longRows.map((row) => row.music_work_id))];
const timestamp = new Date().toISOString();
const sql = `UPDATE music_service_links
SET availability_status = 'unavailable', availability_checked_at = ${sqlText(timestamp)}
WHERE id IN (${linkIds.map(sqlText).join(",")});
UPDATE music_works
SET status = 'removed', updated_at = ${sqlText(timestamp)}
WHERE id IN (${workIds.map(sqlText).join(",")});
`;
const sqlFile = join(process.cwd(), ".remove-long-youtube-music.sql");
writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
try {
  runWrangler(["d1", "execute", "HUB_DATABASE", "--local", "--file", sqlFile]);
} finally {
  unlinkSync(sqlFile);
}

console.log(JSON.stringify({
  checked: rows.length,
  removed: workIds.length,
  tracks: longRows.map(({ title, artist, seconds }) => ({ title, artist, seconds })),
}));
