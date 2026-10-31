import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "data", ".tiktok-video-catalog-local.sql");
const candidates = [
  {
    url: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    category: "動物",
    topic: "ペット",
  },
  {
    url: "https://www.tiktok.com/@theres.food.at.home/video/6931035428350889221",
    category: "料理",
    topic: "レシピ",
  },
  {
    url: "https://www.tiktok.com/@theres.food.at.home/video/6923663550913187077",
    category: "料理",
    topic: "フード",
  },
];

function clean(value, max) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, max);
}
function sql(value) {
  return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}

async function lookup(candidate) {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(candidate.url)}`;
  const response = await fetch(endpoint, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const id = new URL(candidate.url).pathname.split("/").filter(Boolean)[2] ?? "";
  const title = clean(payload.title, 240);
  const channel = clean(payload.author_name, 120);
  if (!/^\d{8,24}$/u.test(id) || !title || !channel || payload.provider_name !== "TikTok") return null;
  return {
    ...candidate,
    id,
    title,
    channel,
    thumbnail: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null,
  };
}

const videos = (await Promise.all(candidates.map(lookup))).filter(Boolean);
if (!videos.length) throw new Error("No public embeddable TikTok videos were available.");

const now = new Date().toISOString();
const statements = ["BEGIN TRANSACTION;"];
for (const video of videos) {
  const values = [
    `seed-tiktok-${video.id}`, "tiktok", video.id, video.url, video.title, video.channel,
    video.category, video.thumbnail, null, now, "profile-me", "active", now, now,
    "other", video.topic, null, 0, "manual", null,
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
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Added ${videos.length} validated TikTok videos.`);
} finally {
  rmSync(sqlPath, { force: true });
}
