import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "data", ".video-catalog-local.sql");
const target = Number(process.env.VIDEO_TARGET_TOTAL ?? 100);
const dataset = "akbargherbal/youtube-music-hits";

function localSecret(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  try {
    const line = readFileSync(path.join(root, ".dev.vars"), "utf8").split(/\r?\n/u).find((entry) => entry.trim().startsWith(`${name}=`));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2") ?? "";
  } catch { return ""; }
}

const apiKey = localSecret("YOUTUBE_DATA_API_KEY");
if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY is required.");
if (!Number.isInteger(target) || target < 1 || target > 200) throw new Error("VIDEO_TARGET_TOTAL must be between 1 and 200.");

function clean(value, max) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, max); }
function sql(value) { return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`; }

async function datasetRows(offset) {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("config", "default");
  url.searchParams.set("split", "train");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", "100");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Dataset request failed: ${response.status}`);
  const payload = await response.json();
  return (payload.rows ?? []).map((entry) => entry?.row).filter(Boolean);
}

async function candidates() {
  const found = [];
  const seen = new Set();
  for (let offset = 0; offset < 20_000 && found.length < target * 3; offset += 100) {
    for (const row of await datasetRows(offset)) {
      const id = clean(row.youtubeId, 11);
      if (!/^[A-Za-z0-9_-]{11}$/u.test(id) || seen.has(id)) continue;
      seen.add(id);
      found.push({ id, fallbackTitle: clean(row.itemLabel, 180), fallbackChannel: clean(row.performerLabel, 120), topic: clean(String(row.genreLabel ?? "音楽").split(",")[0], 80) || "音楽" });
    }
  }
  return found;
}

async function validate(items) {
  const accepted = [];
  const lookup = new Map(items.map((item) => [item.id, item]));
  for (let index = 0; index < items.length && accepted.length < target; index += 50) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("id", items.slice(index, index + 50).map((item) => item.id).join(","));
    url.searchParams.set("key", apiKey);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`YouTube validation failed: ${response.status}`);
    const payload = await response.json();
    for (const video of payload.items ?? []) {
      if (video.status?.privacyStatus !== "public" || video.status?.embeddable !== true || video.status?.madeForKids === true) continue;
      const original = lookup.get(video.id);
      if (!original) continue;
      accepted.push({
        ...original,
        title: clean(video.snippet?.title, 240) || original.fallbackTitle,
        channel: clean(video.snippet?.channelTitle, 120) || original.fallbackChannel,
        thumbnail: video.snippet?.thumbnails?.high?.url ?? video.snippet?.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
        publishedAt: new Date(video.snippet?.publishedAt ?? 0).toISOString(),
      });
      if (accepted.length === target) break;
    }
  }
  if (accepted.length < target) throw new Error(`Only ${accepted.length} valid videos were found.`);
  return accepted;
}

function buildSql(videos) {
  const now = new Date().toISOString();
  const statements = ["BEGIN TRANSACTION;"];
  for (const video of videos) statements.push(`INSERT OR IGNORE INTO external_videos (
    id, provider, external_video_id, source_url, title, channel, category, thumbnail_url,
    duration, published_at, submitted_by_profile_id, status, created_at, updated_at,
    purpose, topic, related_hubpedia_slug, submitter_visible, ingest_source, youtube_metadata_refreshed_at
  ) VALUES (${[
    `seed-video-${video.id}`, "youtube", video.id, `https://www.youtube.com/watch?v=${video.id}`,
    video.title, video.channel, "音楽", video.thumbnail, null, video.publishedAt, "profile-me", "active",
    now, now, "music", video.topic, null, 0, "manual", now,
  ].map(sql).join(", ")});`);
  statements.push("COMMIT;");
  return `${statements.join("\n")}\n`;
}

const videos = await validate(await candidates());
try {
  writeFileSync(sqlPath, buildSql(videos), { encoding: "utf8", mode: 0o600 });
  const wrangler = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Added ${videos.length} validated external video records.`);
} finally {
  rmSync(sqlPath, { force: true });
}
