import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceOrigin = (process.env.HUB_MUSIC_CATALOG_SOURCE_ORIGIN
  ?? "https://jkamma-hub-staging.jammakamma0.workers.dev").replace(/\/$/u, "");
const sqlPath = path.join(root, "data", ".music-public-catalog-restore.sql");
const pageSize = 50;
const maximumWorks = 5_000;
const providers = new Set(["spotify", "youtube", "soundcloud", "apple", "amazon", "bandcamp"]);

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function text(value, maximum, name) {
  const normalized = String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum) throw new Error(`${name} is invalid.`);
  return normalized;
}

function httpsUrl(value, name) {
  const normalized = text(value, 2_048, name);
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  return parsed.toString();
}

function normalizeWork(value) {
  if (!value || typeof value !== "object") throw new Error("Music work is invalid.");
  const id = text(value.id, 180, "work.id");
  if (!/^[A-Za-z0-9:_-]+$/u.test(id)) throw new Error(`work.id is unsafe: ${id}`);
  const year = Number(value.year);
  if (!Number.isInteger(year) || year < 1000 || year > 3000) throw new Error(`work.year is invalid: ${id}`);
  const createdAt = Number.isFinite(Date.parse(value.createdAt))
    ? new Date(value.createdAt).toISOString()
    : new Date().toISOString();
  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags.map((tag) => text(tag, 40, "work.tag")))].slice(0, 12)
    : [];
  const tagSignals = Array.isArray(value.tagSignals) ? value.tagSignals : [];
  const services = (Array.isArray(value.services) ? value.services : []).map((service) => {
    if (!service || typeof service !== "object" || !providers.has(service.provider)) {
      throw new Error(`work.service is invalid: ${id}`);
    }
    const url = httpsUrl(service.url, "service.url");
    const embedUrl = service.embedUrl ? httpsUrl(service.embedUrl, "service.embedUrl") : null;
    if (service.provider === "youtube" && embedUrl) {
      const embed = new URL(embedUrl);
      const videoId = embed.pathname.split("/").filter(Boolean).at(-1) ?? "";
      if (embed.hostname !== "www.youtube-nocookie.com" || !embed.pathname.startsWith("/embed/") || !/^[A-Za-z0-9_-]{11}$/u.test(videoId)) {
        throw new Error(`YouTube embed URL is invalid: ${id}`);
      }
    }
    return { provider: service.provider, url, embedUrl };
  });
  if (!services.some((service) => service.provider === "youtube" && service.embedUrl)) {
    throw new Error(`Playable YouTube source is missing: ${id}`);
  }
  return {
    id,
    title: text(value.title, 180, "work.title"),
    artist: text(value.artist, 120, "work.artist"),
    description: text(value.description, 500, "work.description"),
    genre: text(value.genre, 60, "work.genre"),
    year,
    createdAt,
    tags,
    tagSignals,
    services,
  };
}

async function fetchCatalog() {
  const works = [];
  const ids = new Set();
  let expectedTotal = null;
  for (let offset = 0; expectedTotal === null || offset < expectedTotal; offset += pageSize) {
    const url = new URL("/api/music", sourceOrigin);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Music source returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload.works) || !Number.isInteger(payload.total) || payload.total < 1 || payload.total > maximumWorks) {
      throw new Error("Music source response is invalid.");
    }
    expectedTotal ??= payload.total;
    if (payload.total !== expectedTotal) throw new Error("Music source changed during restore; retry later.");
    for (const raw of payload.works) {
      const work = normalizeWork(raw);
      if (ids.has(work.id)) throw new Error(`Duplicate work id: ${work.id}`);
      ids.add(work.id);
      works.push(work);
    }
    if (!payload.works.length && works.length < expectedTotal) throw new Error("Music source ended before its declared total.");
  }
  if (works.length !== expectedTotal) throw new Error(`Expected ${expectedTotal} works, received ${works.length}.`);
  return works;
}

function buildSql(works) {
  const statements = ["PRAGMA foreign_keys = ON;", "BEGIN TRANSACTION;"];
  for (const work of works) {
    statements.push(`INSERT INTO music_works (
      id, title, artist, description, genre, tags_json, tag_signals_json, release_year,
      submitted_by_profile_id, status, created_at, updated_at
    ) VALUES (${[
      work.id, work.title, work.artist, work.description, work.genre,
      JSON.stringify(work.tags), JSON.stringify(work.tagSignals), work.year,
      "profile-me", "active", work.createdAt, work.createdAt,
    ].map(sql).join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, artist=excluded.artist, description=excluded.description,
      genre=excluded.genre, tags_json=excluded.tags_json, tag_signals_json=excluded.tag_signals_json,
      release_year=excluded.release_year, status='active', updated_at=excluded.updated_at;`);
    for (const service of work.services) {
      statements.push(`INSERT INTO music_service_links (
        id, music_work_id, provider, source_url, embed_url, created_at
      ) VALUES (${[
        `mirror-${work.id}-${service.provider}`, work.id, service.provider,
        service.url, service.embedUrl, work.createdAt,
      ].map(sql).join(", ")})
      ON CONFLICT(music_work_id, provider) DO UPDATE SET
        source_url=excluded.source_url, embed_url=excluded.embed_url;`);
    }
  }
  statements.push("COMMIT;");
  return `${statements.join("\n")}\n`;
}

const works = await fetchCatalog();
try {
  writeFileSync(sqlPath, buildSql(works), "utf8");
  const wrangler = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Restored ${works.length} public music works to the local Hub D1.`);
} finally {
  rmSync(sqlPath, { force: true });
}
