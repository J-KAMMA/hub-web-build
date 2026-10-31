import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "data", ".diverse-video-catalog-local.sql");
const perCategory = Number(process.env.VIDEO_PER_CATEGORY ?? 10);
const categories = [
  { label: "技術", topic: "テクノロジー", purpose: "explanation", query: "テクノロジー 解説" },
  { label: "科学", topic: "科学", purpose: "explanation", query: "科学 解説" },
  { label: "教育", topic: "学習", purpose: "guide", query: "教育 講座" },
  { label: "料理", topic: "料理", purpose: "guide", query: "料理 レシピ 作り方" },
  { label: "旅行", topic: "旅行", purpose: "guide", query: "旅行 ガイド" },
  { label: "ゲーム", topic: "ゲーム", purpose: "review", query: "ゲーム レビュー" },
  { label: "スポーツ", topic: "スポーツ", purpose: "explanation", query: "スポーツ 解説" },
  { label: "DIY", topic: "ものづくり", purpose: "creation", query: "DIY 作り方" },
  { label: "アニメーション", topic: "アニメーション", purpose: "creation", query: "animation short film" },
  { label: "ドキュメンタリー", topic: "ドキュメンタリー", purpose: "other", query: "documentary 日本語" },
];

function localSecret(name) {
  if (process.env[name]?.trim()) return process.env[name].trim();
  try {
    const line = readFileSync(path.join(root, ".dev.vars"), "utf8").split(/\r?\n/u).find((entry) => entry.trim().startsWith(`${name}=`));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2") ?? "";
  } catch { return ""; }
}
const apiKey = localSecret("YOUTUBE_DATA_API_KEY");
if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY is required.");
if (!Number.isInteger(perCategory) || perCategory < 1 || perCategory > 20) throw new Error("VIDEO_PER_CATEGORY must be between 1 and 20.");
function clean(value, max) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, max); }
function sql(value) { return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`; }

async function search(category) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet"); url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "25"); url.searchParams.set("q", category.query);
  url.searchParams.set("relevanceLanguage", "ja"); url.searchParams.set("safeSearch", "strict");
  url.searchParams.set("videoEmbeddable", "true"); url.searchParams.set("key", apiKey);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`YouTube search failed for ${category.label}: ${response.status}`);
  const payload = await response.json();
  return (payload.items ?? []).map((item) => item?.id?.videoId).filter((id) => /^[A-Za-z0-9_-]{11}$/u.test(id));
}

async function validate(ids, category) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,status"); url.searchParams.set("id", ids.join(",")); url.searchParams.set("key", apiKey);
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`YouTube validation failed for ${category.label}: ${response.status}`);
  const payload = await response.json();
  return (payload.items ?? []).filter((video) => video.status?.privacyStatus === "public" && video.status?.embeddable === true && video.status?.madeForKids !== true).map((video) => ({
    id: video.id, category: category.label, topic: category.topic, purpose: category.purpose,
    title: clean(video.snippet?.title, 240), channel: clean(video.snippet?.channelTitle, 120),
    thumbnail: video.snippet?.thumbnails?.high?.url ?? video.snippet?.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    publishedAt: new Date(video.snippet?.publishedAt ?? 0).toISOString(),
  })).filter((video) => video.title && video.channel);
}

const selected = [];
const seen = new Set();
for (const category of categories) {
  const valid = await validate(await search(category), category);
  const unique = valid.filter((video) => !seen.has(video.id)).slice(0, perCategory);
  unique.forEach((video) => seen.add(video.id));
  if (unique.length < perCategory) throw new Error(`${category.label}: only ${unique.length} valid unique videos found.`);
  selected.push(...unique);
}

const now = new Date().toISOString();
const statements = ["BEGIN TRANSACTION;"];
for (const video of selected) statements.push(`INSERT OR IGNORE INTO external_videos (
  id, provider, external_video_id, source_url, title, channel, category, thumbnail_url, duration,
  published_at, submitted_by_profile_id, status, created_at, updated_at, purpose, topic,
  related_hubpedia_slug, submitter_visible, ingest_source, youtube_metadata_refreshed_at
) VALUES (${[`seed-diverse-${video.id}`, "youtube", video.id, `https://www.youtube.com/watch?v=${video.id}`, video.title, video.channel, video.category, video.thumbnail, null, video.publishedAt, "profile-me", "active", now, now, video.purpose, video.topic, null, 0, "manual", now].map(sql).join(", ")});`);
statements.push("COMMIT;");
try {
  writeFileSync(sqlPath, `${statements.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  const wrangler = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Added up to ${selected.length} validated videos across ${categories.length} categories.`);
} finally { rmSync(sqlPath, { force: true }); }
