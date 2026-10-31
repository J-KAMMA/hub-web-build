import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "data", ".youtube-shorts-local.sql");
const perCategory = Number(process.env.SHORTS_PER_CATEGORY ?? 4);
const categories = [
  { label: "料理", topic: "レシピ", query: "料理 レシピ #shorts" },
  { label: "科学", topic: "科学", query: "科学 実験 #shorts" },
  { label: "旅行", topic: "旅行", query: "日本 旅行 #shorts" },
  { label: "スポーツ", topic: "スポーツ", query: "スポーツ #shorts" },
  { label: "動物", topic: "ペット", query: "動物 ペット #shorts" },
];

function localSecret(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  try {
    const line = readFileSync(path.join(root, ".dev.vars"), "utf8").split(/\r?\n/u).find((entry) => entry.trim().startsWith(`${name}=`));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2") ?? "";
  } catch { return ""; }
}
function clean(value, max) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, max); }
function sql(value) { return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`; }
function durationSeconds(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(value ?? "");
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}
function displayDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const apiKey = localSecret("YOUTUBE_DATA_API_KEY");
if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY is required.");
if (!Number.isInteger(perCategory) || perCategory < 1 || perCategory > 10) throw new Error("SHORTS_PER_CATEGORY must be between 1 and 10.");

async function search(category) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "25");
  url.searchParams.set("q", category.query);
  url.searchParams.set("relevanceLanguage", "ja");
  url.searchParams.set("safeSearch", "strict");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("videoDuration", "short");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`YouTube Shorts search failed for ${category.label}: ${response.status}`);
  const payload = await response.json();
  return (payload.items ?? []).map((item) => item?.id?.videoId).filter((id) => /^[A-Za-z0-9_-]{11}$/u.test(id));
}

async function validate(ids, category) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,status,contentDetails");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`YouTube Shorts validation failed for ${category.label}: ${response.status}`);
  const payload = await response.json();
  return (payload.items ?? []).flatMap((video) => {
    const seconds = durationSeconds(video.contentDetails?.duration);
    if (video.status?.privacyStatus !== "public" || video.status?.embeddable !== true || video.status?.madeForKids === true || seconds < 1 || seconds > 180) return [];
    const title = clean(video.snippet?.title, 240);
    const channel = clean(video.snippet?.channelTitle, 120);
    if (!title || !channel) return [];
    return [{
      id: video.id,
      title,
      channel,
      category: category.label,
      topic: category.topic,
      duration: displayDuration(seconds),
      thumbnail: video.snippet?.thumbnails?.high?.url ?? video.snippet?.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      publishedAt: new Date(video.snippet?.publishedAt ?? 0).toISOString(),
    }];
  });
}

const selected = [];
const seen = new Set();
for (const category of categories) {
  const valid = await validate(await search(category), category);
  const unique = valid.filter((video) => !seen.has(video.id)).slice(0, perCategory);
  unique.forEach((video) => seen.add(video.id));
  selected.push(...unique);
}
if (!selected.length) throw new Error("No validated YouTube Shorts were found.");

const now = new Date().toISOString();
const statements = ["BEGIN TRANSACTION;"];
for (const video of selected) {
  const values = [
    `seed-short-${video.id}`, "youtube", video.id, `https://www.youtube.com/shorts/${video.id}`,
    video.title, video.channel, video.category, video.thumbnail, video.duration, video.publishedAt,
    "profile-me", "active", now, now, "other", video.topic, null, 0, "manual", now,
  ];
  statements.push(`INSERT OR IGNORE INTO external_videos (
    id, provider, external_video_id, source_url, title, channel, category, thumbnail_url, duration,
    published_at, submitted_by_profile_id, status, created_at, updated_at, purpose, topic,
    related_hubpedia_slug, submitter_visible, ingest_source, youtube_metadata_refreshed_at
  ) VALUES (${values.map(sql).join(", ")});`);
}
statements.push("COMMIT;");

try {
  writeFileSync(sqlPath, `${statements.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  const wrangler = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Added ${selected.length} validated YouTube Shorts.`);
} finally {
  rmSync(sqlPath, { force: true });
}
