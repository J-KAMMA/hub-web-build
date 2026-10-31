import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "data", ".music-catalog-local.sql");
const dataset = "akbargherbal/youtube-music-hits";
const origin = process.env.HUB_LOCAL_ORIGIN?.trim() || "http://localhost:3020";
const targetTotal = Number(process.env.MUSIC_TARGET_TOTAL ?? 1000);
const maxDatasetRows = Number(process.env.MUSIC_MAX_DATASET_ROWS ?? 50_000);
const youtubeApiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();

if (!Number.isInteger(targetTotal) || targetTotal < 1 || targetTotal > 1200) throw new Error("MUSIC_TARGET_TOTAL must be between 1 and 1200.");
if (!Number.isInteger(maxDatasetRows) || maxDatasetRows < 100 || maxDatasetRows > 100_000) throw new Error("MUSIC_MAX_DATASET_ROWS must be between 100 and 100000.");
if (!youtubeApiKey) throw new Error("YOUTUBE_DATA_API_KEY is required to validate music videos before seeding.");

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function videoIdFromUrl(value) {
  try {
    const url = new URL(value);
    const id = url.searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
  } catch {
    return null;
  }
}

function cleanText(value, maxLength) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, maxLength);
}

const genreLabels = {
  "alternative hip hop": "オルタナティブ・ヒップホップ",
  "alternative r&b": "オルタナティブR&B",
  "alternative rock": "オルタナティブ・ロック",
  bachata: "バチャータ",
  ballade: "バラード",
  "baroque pop": "バロック・ポップ",
  "bubblegum dance": "バブルガム・ダンス",
  "contemporary r&b": "コンテンポラリーR&B",
  "dance music": "ダンス",
  "dance-pop": "ダンス・ポップ",
  dancehall: "ダンスホール",
  "electro house": "エレクトロ・ハウス",
  "electronic dance music": "EDM",
  "electronic music": "エレクトロニック",
  electropop: "エレクトロポップ",
  "folk rock": "フォークロック",
  funk: "ファンク",
  "hard rock": "ハードロック",
  "hip hop music": "ヒップホップ",
  "house music": "ハウス",
  "indie pop": "インディー・ポップ",
  "latin pop": "ラテン・ポップ",
  "latin trap": "ラテン・トラップ",
  moombahton: "ムーンバートン",
  music: "音楽",
  "pop music": "ポップ",
  "pop rock": "ポップロック",
  rap: "ラップ",
  "rap rock": "ラップロック",
  reggae: "レゲエ",
  "reggae fusion": "レゲエ・フュージョン",
  reggaeton: "レゲトン",
  "short film": "ポップ",
  "soft rock": "ソフトロック",
  soul: "ソウル",
  "trap music": "トラップ",
  "tropical house": "トロピカル・ハウス",
};

function translateGenre(value) {
  const genre = cleanText(value, 60) || "Music";
  return genreLabels[genre.toLocaleLowerCase("en-US")] ?? genre;
}

async function fetchRows(offset) {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("config", "default");
  url.searchParams.set("split", "train");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", "100");
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Dataset request failed: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.rows) ? payload.rows.map((entry) => entry?.row).filter(Boolean) : [];
}

const NON_MUSIC_TITLE_PATTERN = /(?:\b(?:podcast|interview|reaction|review|gameplay|trailer|tutorial|news|commentary)\b|ポッドキャスト|インタビュー|リアクション|レビュー|ゲーム実況|実況プレイ|予告編|ニュース|解説動画|雑談)/iu;

function durationSeconds(value) {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(String(value ?? ""));
  if (!match) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

async function validatedMusicVideoIds(videoIds) {
  const accepted = new Set();
  for (let index = 0; index < videoIds.length; index += 50) {
    const batch = videoIds.slice(index, index + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", youtubeApiKey);
    const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`YouTube validation failed: ${response.status}`);
    const payload = await response.json();
    for (const video of Array.isArray(payload.items) ? payload.items : []) {
      const duration = durationSeconds(video?.contentDetails?.duration);
      const title = cleanText(video?.snippet?.title, 180);
      if (!/^[A-Za-z0-9_-]{11}$/u.test(String(video?.id ?? ""))) continue;
      if (video?.status?.privacyStatus !== "public" || video?.status?.embeddable !== true || video?.status?.madeForKids === true) continue;
      if (video?.snippet?.categoryId !== "10" || video?.snippet?.liveBroadcastContent !== "none") continue;
      if (duration === null || duration < 60 || !title || NON_MUSIC_TITLE_PATTERN.test(title)) continue;
      accepted.add(video.id);
    }
  }
  return accepted;
}

async function existingCatalog() {
  const response = await fetch(`${origin}/api/music`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Local music API request failed: ${response.status}`);
  const payload = await response.json();
  const ids = new Set();
  const workKeys = new Set();
  for (const work of Array.isArray(payload.works) ? payload.works : []) {
    const title = cleanText(work?.title, 180);
    const artist = cleanText(work?.artist, 120);
    if (title && artist) workKeys.add(`${artist}\u0000${title}`.toLocaleLowerCase("en"));
    for (const service of Array.isArray(work.services) ? work.services : []) {
      const id = videoIdFromUrl(service.url) ?? videoIdFromUrl(service.embedUrl);
      if (id) ids.add(id);
    }
  }
  return { videoIds: ids, workKeys };
}

async function selectTracks(targetCount, existing) {
  if (targetCount <= 0) return [];
  const candidates = [];
  const seenVideos = new Set(existing.videoIds);
  const seenWorks = new Set(existing.workKeys);

  for (let offset = 0; offset < maxDatasetRows && candidates.length < Math.max(targetCount * 2, targetCount + 200); offset += 100) {
    const rows = await fetchRows(offset);
    if (!rows.length) break;
    for (const row of rows) {
      const youtubeId = cleanText(row.youtubeId, 11);
      const title = cleanText(row.itemLabel, 180);
      const artist = cleanText(row.performerLabel, 120);
      const workKey = `${artist}\u0000${title}`.toLocaleLowerCase("en");
      const year = Math.trunc(Number(row.year));
      if (!/^[A-Za-z0-9_-]{11}$/u.test(youtubeId) || !title || !artist || seenVideos.has(youtubeId) || seenWorks.has(workKey)) continue;
      if (!Number.isInteger(year) || year < 1000 || year > new Date().getFullYear() + 1) continue;
      seenVideos.add(youtubeId);
      seenWorks.add(workKey);
      candidates.push({
        youtubeId,
        title,
        artist,
        year,
        genre: translateGenre(String(row.genreLabel ?? "Music").split(",")[0]),
      });
    }
  }

  const accepted = await validatedMusicVideoIds(candidates.map((track) => track.youtubeId));
  const selected = candidates.filter((track) => accepted.has(track.youtubeId)).slice(0, targetCount);
  if (selected.length !== targetCount) throw new Error(`Only ${selected.length} public, non-duplicate tracks were found.`);
  return selected;
}

function buildSql(tracks) {
  const now = Date.now();
  const statements = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];
  tracks.forEach((track, index) => {
    const workId = `music-hit-${track.youtubeId}`;
    const linkId = `music-link-${track.youtubeId}`;
    const timestamp = new Date(now - index).toISOString();
    statements.push(`INSERT OR IGNORE INTO music_works (
      id, title, artist, description, genre, release_year, submitted_by_profile_id, status, created_at, updated_at
    ) VALUES (${[
      workId,
      track.title,
      track.artist,
      "YouTubeで公開されている音楽作品です。",
      track.genre,
      track.year,
      "profile-me",
      "active",
      timestamp,
      timestamp,
    ].map(sql).join(", ")});`);
    statements.push(`INSERT OR IGNORE INTO music_service_links (
      id, music_work_id, provider, source_url, embed_url, created_at
    ) VALUES (${[
      linkId,
      workId,
      "youtube",
      `https://www.youtube.com/watch?v=${track.youtubeId}`,
      `https://www.youtube-nocookie.com/embed/${track.youtubeId}`,
      timestamp,
    ].map(sql).join(", ")});`);
  });
  statements.push("COMMIT;");
  return `${statements.join("\n")}\n`;
}

const currentCatalog = await existingCatalog();
const tracks = await selectTracks(Math.max(0, targetTotal - currentCatalog.videoIds.size), currentCatalog);
if (!tracks.length) {
  console.log(`Music catalog already has ${currentCatalog.videoIds.size} works; target is ${targetTotal}.`);
  process.exit(0);
}
try {
  writeFileSync(sqlPath, buildSql(tracks), "utf8");
  const wranglerCli = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(
    process.execPath,
    [wranglerCli, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
      env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, "data", ".wrangler-music-seed.log") },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Added ${tracks.length} music works; target catalog size is ${targetTotal}.`);
} finally {
  rmSync(sqlPath, { force: true });
}
