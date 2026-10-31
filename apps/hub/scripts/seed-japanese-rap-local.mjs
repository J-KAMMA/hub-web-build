import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "data", ".japanese-rap-local.sql");
const apiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
const target = Number(process.env.JAPANESE_RAP_TARGET ?? 30);
if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY is required.");
if (!Number.isInteger(target) || target < 1 || target > 50) throw new Error("JAPANESE_RAP_TARGET must be between 1 and 50.");

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function clean(value, maximum = 180) {
  return String(value ?? "").normalize("NFKC").replace(/&amp;/giu, "&").replace(/&#39;/giu, "'").replace(/&quot;/giu, '"').replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function durationSeconds(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(String(value ?? ""));
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : null;
}

async function youtube(pathname, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`YouTube API ${pathname} failed: ${response.status}`);
  return response.json();
}

async function searchCandidates() {
  const candidates = new Map();
  for (const query of ["日本語ラップ 公式 MV", "ジャパニーズヒップホップ 公式 ミュージックビデオ"]) {
    const payload = await youtube("search", {
      part: "snippet", q: query, type: "video", videoCategoryId: "10", videoEmbeddable: "true",
      maxResults: 50, order: "relevance", regionCode: "JP", relevanceLanguage: "ja", safeSearch: "moderate",
    });
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      const id = clean(item?.id?.videoId, 11);
      if (/^[A-Za-z0-9_-]{11}$/u.test(id)) candidates.set(id, item.snippet);
    }
  }
  return candidates;
}

function trackMetadata(id, video) {
  const rawTitle = clean(video.snippet?.title);
  const separator = rawTitle.match(/^(.{1,80}?)\s+(?:-|–|—|「|『)\s*(.{1,140})$/u);
  const channel = clean(video.snippet?.channelTitle, 120).replace(/\s*[-–—]?\s*(?:Topic|VEVO|公式)$/iu, "").trim();
  const artist = clean(separator?.[1] ?? channel, 120);
  const title = clean(separator?.[2] ?? rawTitle, 180)
    .replace(/\s*[\[（【(].*?(?:official|music video|mv|pv|visualizer|lyric).*?[\]）】)]\s*$/iu, "")
    .trim();
  const year = Number.parseInt(String(video.snippet?.publishedAt ?? "").slice(0, 4), 10);
  return { id, artist: artist || channel, title, year: Number.isInteger(year) ? year : new Date().getFullYear() };
}

const candidates = await searchCandidates();
const videos = [];
const ids = [...candidates.keys()];
for (let index = 0; index < ids.length; index += 50) {
  const payload = await youtube("videos", { part: "snippet,contentDetails,status", id: ids.slice(index, index + 50).join(",") });
  for (const video of Array.isArray(payload.items) ? payload.items : []) {
    const seconds = durationSeconds(video.contentDetails?.duration);
    if (video.status?.privacyStatus !== "public" || video.status?.embeddable !== true || video.status?.madeForKids === true) continue;
    if (video.snippet?.categoryId !== "10" || video.snippet?.liveBroadcastContent !== "none") continue;
    if (seconds === null || seconds < 90 || seconds > 720) continue;
    const metadata = trackMetadata(video.id, video);
    if (!metadata.title || !metadata.artist) continue;
    videos.push(metadata);
  }
}

const now = Date.now();
const statements = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];
for (const [index, track] of videos.slice(0, target).entries()) {
  const timestamp = new Date(now - index).toISOString();
  statements.push(`INSERT OR IGNORE INTO music_works (id, title, artist, description, genre, release_year, submitted_by_profile_id, status, created_at, updated_at) VALUES (${[
    `music-jp-rap-${track.id}`, track.title, track.artist, "YouTubeで公開されている日本語ラップ作品です。", "日本語ラップ", track.year,
    "profile-me", "active", timestamp, timestamp,
  ].map(sql).join(", ")});`);
  statements.push(`INSERT OR IGNORE INTO music_service_links (id, music_work_id, provider, source_url, embed_url, created_at) VALUES (${[
    `music-link-${track.id}`, `music-jp-rap-${track.id}`, "youtube", `https://www.youtube.com/watch?v=${track.id}`,
    `https://www.youtube-nocookie.com/embed/${track.id}`, timestamp,
  ].map(sql).join(", ")});`);
}
statements.push("COMMIT;");
if (videos.length < target) throw new Error(`Only ${videos.length} valid Japanese rap candidates were found.`);

try {
  writeFileSync(sqlPath, `${statements.join("\n")}\n`, "utf8");
  const wranglerCli = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wranglerCli, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath], {
    cwd: root, encoding: "utf8", stdio: "inherit",
    env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, "data", ".wrangler-japanese-rap.log") },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Selected and inserted up to ${target} validated Japanese rap tracks.`);
} finally {
  rmSync(sqlPath, { force: true });
}
