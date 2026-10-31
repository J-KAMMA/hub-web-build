import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { musicGenreCategoryLabel } from "../lib/music-catalog";

const root = path.resolve(import.meta.dirname, "..");
const origin = process.env.HUB_LOCAL_ORIGIN?.trim() || "http://127.0.0.1:3020";
const apiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
const minimum = Number(process.env.MUSIC_GENRE_MINIMUM ?? 50);
if (!apiKey) throw new Error("YOUTUBE_DATA_API_KEY is required.");

const queries: Record<string, string> = {
  "その他": "world music official audio",
  "メタル": "metal official music video",
  "レゲエ": "reggae official music video",
  "K-POP": "K-POP official MV",
  "J-POP": "J-POP official music video",
  "ジャズ・ブルース": "jazz blues official audio",
  "カントリー": "country music official video",
  "フォーク": "folk music official audio",
};

type Work = { id: string; title: string; artist: string; genre: string; services: Array<{ url?: string; embedUrl?: string }> };
type Candidate = { id: string; title: string; artist: string; category: string; year: number };
const clean = (value: unknown, max: number) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, max);
const sql = (value: unknown) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const videoId = (value?: string) => { try { const url = new URL(value ?? ""); return url.searchParams.get("v") ?? url.pathname.split("/").at(-1) ?? ""; } catch { return ""; } };

async function catalog() {
  const works: Work[] = [];
  let offset = 0, total = 1;
  while (offset < total) {
    const response = await fetch(`${origin}/api/music?limit=50&offset=${offset}`);
    if (!response.ok) throw new Error(`Music API failed: ${response.status}`);
    const page = await response.json() as { works: Work[]; total: number };
    works.push(...page.works); total = page.total; offset += page.works.length;
    if (!page.works.length) break;
  }
  return works;
}

async function search(category: string, need: number, excluded: Set<string>) {
  const found = new Map<string, Candidate>();
  let pageToken = "";
  for (let page = 0; page < 4 && found.size < need; page++) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet"); url.searchParams.set("type", "video");
    url.searchParams.set("videoCategoryId", "10"); url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("maxResults", "50"); url.searchParams.set("q", queries[category]); url.searchParams.set("key", apiKey!);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`YouTube search failed (${category}): ${response.status}`);
    const body = await response.json() as any; pageToken = body.nextPageToken ?? "";
    for (const item of body.items ?? []) {
      const id = clean(item?.id?.videoId, 11); if (!/^[\w-]{11}$/u.test(id) || excluded.has(id)) continue;
      found.set(id, { id, title: clean(item.snippet?.title, 180), artist: clean(item.snippet?.channelTitle, 120), category, year: Number(String(item.snippet?.publishedAt ?? "").slice(0, 4)) || new Date().getFullYear() });
    }
    if (!pageToken) break;
  }
  const candidates = [...found.values()];
  const accepted: Candidate[] = [];
  for (let index = 0; index < candidates.length && accepted.length < need; index += 50) {
    const batch = candidates.slice(index, index + 50);
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,status"); url.searchParams.set("id", batch.map((v) => v.id).join(",")); url.searchParams.set("key", apiKey!);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`YouTube validation failed: ${response.status}`);
    const body = await response.json() as any;
    for (const item of body.items ?? []) {
      const duration = String(item.contentDetails?.duration ?? "");
      const parts = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/u.exec(duration);
      const seconds = parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0) : 0;
      const candidate = found.get(item.id);
      if (candidate && item.snippet?.categoryId === "10" && item.status?.privacyStatus === "public" && item.status?.embeddable === true && item.status?.madeForKids !== true && seconds >= 60) accepted.push(candidate);
      if (accepted.length >= need) break;
    }
  }
  return accepted;
}

async function main() {
const works = await catalog();
const counts = new Map<string, number>();
const excluded = new Set<string>();
for (const work of works) {
  const category = musicGenreCategoryLabel(work.genre); counts.set(category, (counts.get(category) ?? 0) + 1);
  for (const service of work.services) { const id = videoId(service.url) || videoId(service.embedUrl); if (id) excluded.add(id); }
}
const additions: Candidate[] = [];
for (const category of Object.keys(queries)) {
  const need = Math.max(0, minimum - (counts.get(category) ?? 0));
  if (!need) continue;
  const tracks = await search(category, need, excluded);
  if (tracks.length < need) throw new Error(`${category}: needed ${need}, found ${tracks.length}`);
  additions.push(...tracks); tracks.forEach((track) => excluded.add(track.id));
}
if (!additions.length) { console.log("All broad genres already meet the minimum."); process.exit(0); }
const now = Date.now();
const statements = ["BEGIN TRANSACTION;"];
additions.forEach((track, index) => {
  const created = new Date(now - index).toISOString();
  statements.push(`INSERT OR IGNORE INTO music_works (id,title,artist,description,genre,release_year,submitted_by_profile_id,status,created_at,updated_at) VALUES (${[ `music-balanced-${track.id}`, track.title, track.artist, "YouTubeで公開されている音楽作品です。", track.category, track.year, "profile-me", "active", created, created ].map(sql).join(",")});`);
  statements.push(`INSERT OR IGNORE INTO music_service_links (id,music_work_id,provider,source_url,embed_url,created_at) VALUES (${[ `music-balanced-link-${track.id}`, `music-balanced-${track.id}`, "youtube", `https://www.youtube.com/watch?v=${track.id}`, `https://www.youtube-nocookie.com/embed/${track.id}`, created ].map(sql).join(",")});`);
});
statements.push("COMMIT;");
const sqlPath = path.join(root, "data", ".music-genre-balance.sql");
try {
  writeFileSync(sqlPath, statements.join("\n"), "utf8");
  const wrangler = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Added ${additions.length} tracks across ${Object.keys(queries).length} broad genres.`);
} finally { rmSync(sqlPath, { force: true }); }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Music genre balancing failed.");
  process.exitCode = 1;
});
