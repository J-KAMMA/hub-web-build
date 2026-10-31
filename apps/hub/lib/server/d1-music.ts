import { normalizeTagList } from "@jkamma/content-tags";
import { indexD1ContentTags } from "@/lib/server/d1-content-tags";
import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { MUSIC_PROVIDER_LABELS, canonicalizeMusicWork, canonicalizeMusicWorks, hasHubFullPlaybackSource, musicGenreLabel, type MusicProvider, type MusicServiceLink, type MusicWork } from "@/lib/music-catalog";
import type { NormalizedMusicSource } from "@/lib/music-source";
import { effectiveMusicTags, inferMusicTagSignals, type MusicTagKind, type MusicTagSignal } from "@/lib/music-tagging";

type MusicRow = {
  id: string; title: string; artist: string; description: string; genre: string; release_year: number;
  tags_json: string; tag_signals_json: string;
  created_at: string; submitter_display_name: string | null; provider: MusicProvider;
  source_url: string; embed_url: string | null;
};

export interface CreateMusicWorkInput {
  title: string; artist: string; description: string; genre: string; tags: string[]; tagSignals?: MusicTagSignal[]; year: number;
  services: NormalizedMusicSource[];
}

export type MusicGenreFacet = { genre: string; sourceGenre: string; count: number };
export type MusicTagFacet = { tag: string; count: number; kind: MusicTagKind };

/*
 * Tags are stored as a JSON array on the work, so the facet count walks them
 * with json_each rather than grouping a column. A work carries its genre, its
 * decade, its language and its tempo as separate tags, which is why this
 * returns far more entries than the genre facets it replaces.
 */
/*
 * Ordered by what makes a usable entry point, not by how many works carry it.
 * Counted alone, the list opened with 英語 (1245) and 中速 (1107) — true of
 * almost everything, and so useful for narrowing almost nothing. A work's
 * signals record what each tag is, which is enough to lead with the kinds
 * someone browsing music actually reaches for.
 */
const TAG_KIND_ORDER: readonly MusicTagKind[] = [
  "genre", "theme", "mood", "scene", "instrument", "region", "era", "feature", "language", "tempo",
];

/*
 * Catch-alls. They are genuine tags and stay selectable, but they say only
 * that nothing more specific was known, so they do not belong in the first
 * screenful where the genres are.
 */
const TAG_PLACEHOLDERS = new Set(["未分類", "その他", "音楽"]);

/*
 * How many of each kind reach the screen. Ordering by kind alone let one
 * fill the whole list: 131 genres against 60 visible slots meant every mood
 * and scene fell off the end, and the axes worth browsing were invisible.
 */
const TAG_KIND_QUOTA: Partial<Record<MusicTagKind, number>> = {
  genre: 24, mood: 10, scene: 10, theme: 8, instrument: 6, region: 4, era: 8, feature: 6, language: 4, tempo: 4,
};

/*
 * Walks every work and every signal on it. At 1312 works that is 16,394 rows
 * read, and it grows with the catalogue, so it is not something a page load
 * should do — refreshMusicTagFacets stores the answer and listD1MusicTagFacets
 * reads it back in tens of rows.
 */
export async function computeMusicTagFacets(database: D1Database, limit = 200): Promise<MusicTagFacet[]> {
  /*
   * A tag can be labelled differently by different works, so the kind is the
   * one the most works agree on rather than whichever row is read first.
   */
  const result = await database.prepare(`SELECT
      json_extract(signal.value, '$.tag') AS tag,
      json_extract(signal.value, '$.kind') AS kind,
      COUNT(*) AS count
    FROM music_works, json_each(music_works.tag_signals_json) AS signal
    WHERE music_works.status='active' AND json_valid(music_works.tag_signals_json)
    GROUP BY tag, kind ORDER BY count DESC`)
    .all<{ tag: string; kind: string; count: number }>();

  const byTag = new Map<string, { tag: string; count: number; kind: MusicTagKind }>();
  for (const row of result.results) {
    if (typeof row.tag !== "string" || !row.tag.trim()) continue;
    const kind = TAG_KIND_ORDER.includes(row.kind as MusicTagKind) ? row.kind as MusicTagKind : "feature";
    const count = Number(row.count) || 0;
    const current = byTag.get(row.tag);
    /* Rows arrive count-descending, so the first kind seen is the agreed one. */
    if (current) current.count += count;
    else byTag.set(row.tag, { tag: row.tag, count, kind });
  }

  return orderMusicTagFacets([...byTag.values()], limit);
}

/* Shared, so a stored facet and a freshly counted one arrive in one order. */
function orderMusicTagFacets(facets: MusicTagFacet[], limit: number): MusicTagFacet[] {
  const ranked = [...facets].sort((left, right) =>
    Number(TAG_PLACEHOLDERS.has(left.tag)) - Number(TAG_PLACEHOLDERS.has(right.tag))
    || right.count - left.count
    || left.tag.localeCompare(right.tag, "ja-JP"));

  /* Each kind keeps its own places, then the kinds are laid out in order. */
  const kept = new Map<MusicTagKind, MusicTagFacet[]>();
  for (const facet of ranked) {
    const bucket = kept.get(facet.kind) ?? [];
    if (bucket.length >= (TAG_KIND_QUOTA[facet.kind] ?? 6)) continue;
    bucket.push(facet);
    kept.set(facet.kind, bucket);
  }
  return TAG_KIND_ORDER.flatMap((kind) => kept.get(kind) ?? [])
    .slice(0, Math.max(1, Math.min(500, Math.trunc(limit))));
}

export async function listD1MusicGenreFacets(database: D1Database): Promise<MusicGenreFacet[]> {
  const result = await database.prepare(`SELECT id, title, artist, genre FROM music_works
    WHERE status='active' AND EXISTS (
      SELECT 1 FROM music_service_links l WHERE l.music_work_id = music_works.id
        AND l.availability_status != 'unavailable' AND l.provider = 'youtube'
        AND l.embed_url IS NOT NULL AND l.embed_url != ''
    ) ORDER BY created_at DESC, id DESC`).all<{id:string;title:string;artist:string;genre:string}>();
  /* Keep facet totals in step with canonicalizeMusicWorks, which removes the
   * same title/artist duplicate before a shelf renders it. */
  const seen = new Set<string>();
  const counts = new Map<string, { sourceGenre: string; count: number }>();
  for (const row of result.results) {
    const key = `${row.artist.normalize("NFKC").trim()}\u0000${row.title.normalize("NFKC").trim()}`.toLocaleLowerCase("ja-JP");
    if (seen.has(key)) continue;
    seen.add(key);
    const genre = musicGenreLabel(row.genre);
    const current = counts.get(genre) ?? { sourceGenre: row.genre, count: 0 };
    current.count += 1;
    counts.set(genre, current);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0], "ja-JP"))
    .map(([genre, value]) => ({ genre, sourceGenre: value.sourceGenre, count: value.count }));
}

const ACCENTS = ["#c7dcf2", "#e7b6b6", "#d8c4ed", "#d7f238", "#efd3a9", "#bfe1cf"];

function rowTags(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : []; }
  catch { return []; }
}

function rowTagSignals(value: string): MusicTagSignal[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is MusicTagSignal =>
      Boolean(item) && typeof item === "object" && typeof Reflect.get(item, "tag") === "string"
      && typeof Reflect.get(item, "confidence") === "number") : [];
  } catch { return []; }
}

function presentation(id: string, title: string, artist: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const symbol = `${artist[0] ?? "M"}${title[0] ?? "♪"}`.toLocaleUpperCase("ja-JP");
  return { accent: ACCENTS[hash % ACCENTS.length], symbol };
}

export async function listD1MusicWorks(database: D1Database): Promise<MusicWork[]> {
  const result = await database.prepare(`SELECT w.id, w.title, w.artist, w.description, w.genre, w.tags_json, w.tag_signals_json, w.release_year,
      w.created_at, p.display_name AS submitter_display_name,
      l.provider, l.source_url, l.embed_url
    FROM music_works w
    JOIN music_service_links l ON l.music_work_id = w.id AND l.availability_status != 'unavailable'
    LEFT JOIN profiles p ON p.id = w.submitted_by_profile_id
    WHERE w.status = 'active'
    ORDER BY w.created_at DESC, l.provider ASC
    LIMIT 7200`).all<MusicRow>();
  const works = new Map<string, MusicWork>();
  for (const row of result.results) {
    let work = works.get(row.id);
    if (!work) {
      const base = { title: row.title, artist: row.artist, description: row.description, genre: musicGenreLabel(row.genre), year: row.release_year };
      const tagSignals = rowTagSignals(row.tag_signals_json);
      work = { id: row.id, ...base, tagSignals: tagSignals.length ? tagSignals : inferMusicTagSignals({ ...base, tags: rowTags(row.tags_json) }),
        tags: effectiveMusicTags({ ...base, tags: rowTags(row.tags_json), tagSignals }),
        ...presentation(row.id, row.title, row.artist), source: "community",
        submittedBy: row.submitter_display_name ?? undefined, createdAt: row.created_at, services: [] };
      works.set(row.id, work);
    }
    work.services.push({ provider: row.provider, label: MUSIC_PROVIDER_LABELS[row.provider], url: row.source_url, embedUrl: row.embed_url ?? undefined });
  }
  return canonicalizeMusicWorks([...works.values()]).filter(hasHubFullPlaybackSource).slice(0, 1200);
}

/*
 * Works named by id, in the order given. The vector index answers with ids
 * and a score; the order it found them in is the answer, so re-sorting by
 * date here would throw away the ranking that was the point of asking.
 */
export async function listD1MusicWorksByIds(database: D1Database, ids: readonly string[]): Promise<MusicWork[]> {
  const wanted = [...new Set(ids)].slice(0, 60);
  if (!wanted.length) return [];
  /*
   * status is filtered after the read, not in the WHERE. With it there,
   * SQLite drove the query from the status index — 1,312 active works — and
   * fetching five of them read 1,323 rows. Asking by id alone lets the
   * primary key drive: twenty rows for the same five works.
   */
  const result = await database.prepare(`SELECT w.id, w.status, w.title, w.artist, w.description, w.genre, w.tags_json, w.tag_signals_json, w.release_year,
      w.created_at, p.display_name AS submitter_display_name,
      l.provider, l.source_url, l.embed_url
    FROM music_works w
    JOIN music_service_links l ON l.music_work_id = w.id AND l.availability_status != 'unavailable'
    LEFT JOIN profiles p ON p.id = w.submitted_by_profile_id
    WHERE w.id IN (${wanted.map(() => "?").join(",")})
    ORDER BY l.provider ASC`).bind(...wanted).all<MusicRow & { status: string }>();

  const built = new Map<string, MusicWork>();
  for (const row of result.results) {
    if (row.status !== "active") continue;
    let work = built.get(row.id);
    if (!work) {
      const base = { title: row.title, artist: row.artist, description: row.description, genre: musicGenreLabel(row.genre), year: row.release_year };
      const tagSignals = rowTagSignals(row.tag_signals_json);
      work = { id: row.id, ...base, tagSignals: tagSignals.length ? tagSignals : inferMusicTagSignals({ ...base, tags: rowTags(row.tags_json) }),
        tags: effectiveMusicTags({ ...base, tags: rowTags(row.tags_json), tagSignals }),
        ...presentation(row.id, row.title, row.artist), source: "community",
        submittedBy: row.submitter_display_name ?? undefined, createdAt: row.created_at, services: [] };
      built.set(row.id, work);
    }
    work.services.push({ provider: row.provider, label: MUSIC_PROVIDER_LABELS[row.provider], url: row.source_url, embedUrl: row.embed_url ?? undefined });
  }
  /* Back into the order the index gave, which is the ranking. */
  return canonicalizeMusicWorks(wanted.map((id) => built.get(id)).filter((work): work is MusicWork => Boolean(work)))
    .filter(hasHubFullPlaybackSource);
}

export async function listD1MusicWorksPage(database: D1Database, limit: number, offset: number, genres: string[] = [], tags: string[] = [], query = "", rankedIds: readonly string[] = []): Promise<{ works: MusicWork[]; total: number; nextOffset: number }> {
  const pageSize = Math.max(1, Math.min(60, Math.trunc(limit)));
  const pageOffset = Math.max(0, Math.trunc(offset));
  const selectedGenres = [...new Set(genres.map((genre) => genre.normalize("NFKC").trim()).filter(Boolean))].slice(0, 100);
  const genreClause = selectedGenres.length ? ` AND genre IN (${selectedGenres.map(() => "?").join(",")})` : "";
  const selectedTags = [...new Set(tags.map((tag) => tag.normalize("NFKC").trim()).filter(Boolean))].slice(0, 8);
  /*
   * Every named tag must be present, so browsing can narrow: ロック and then
   * 1990年代 and then 日本語. json_each is used rather than a LIKE over the raw
   * text, which would match a tag that merely contains the word.
   */
  const tagClause = selectedTags.map(() => ` AND EXISTS (SELECT 1 FROM json_each(w.tags_json) AS t WHERE json_valid(w.tags_json) AND t.value = ?)`).join("");
  /*
   * Searching in the browser only ever saw the hundred works the screen was
   * holding, so a song that exists was reported as not found. The title, the
   * artist and the tags are matched here instead, over the whole catalogue.
   */
  const needle = query.normalize("NFKC").trim().toLocaleLowerCase("ja-JP").slice(0, 120);
  /*
   * Three bare placeholders rather than one named ?1. SQLite numbers a bare
   * "?" from the highest already assigned, so a named parameter written after
   * the genre and tag placeholders would collide with the first of them.
   */
  const searchClause = needle
    ? " AND (lower(title) LIKE ? OR lower(artist) LIKE ? OR lower(tags_json) LIKE ?)"
    : "";
  const searchBindings = needle ? [`%${needle}%`, `%${needle}%`, `%${needle}%`] : [];
  const ranking = [...new Set(rankedIds)].slice(0, 60);
  const rankCte = ranking.length ? "ranked AS (SELECT value AS work_id, key AS position FROM json_each(?)), " : "";
  const rankOrder = (id: string) => ranking.length ? `COALESCE((SELECT position FROM ranked WHERE work_id = ${id}), 2147483647), ` : "";
  /*
   * Fetch the filtered catalogue before pagination.  The UI canonicalizes
   * title/artist duplicates, so paginating raw rows made `total` and
   * `nextOffset` count songs that could never be displayed (and could leave
   * empty continuation pages).  The catalogue is bounded at 7,200 works, the
   * same ceiling used by the full read below; canonicalization then gives the
   * API one stable unit of pagination and keeps duplicate songs out of counts.
   */
  const result = await database.prepare(`WITH ${rankCte}catalogue AS (
      SELECT w.id, w.title, w.artist, w.description, w.genre, w.tags_json, w.tag_signals_json, w.release_year,
        w.created_at, w.submitted_by_profile_id
      FROM music_works w
      WHERE w.status = 'active'${genreClause}${tagClause}${searchClause}
        AND EXISTS (
          SELECT 1 FROM music_service_links playable
          WHERE playable.music_work_id = w.id
            AND playable.availability_status != 'unavailable'
            AND playable.provider = 'youtube'
            AND playable.embed_url IS NOT NULL
            AND playable.embed_url != ''
        )
      ORDER BY ${rankOrder("w.id")}w.created_at DESC, w.id DESC
      LIMIT 7200
    )
    SELECT c.id, c.title, c.artist, c.description, c.genre, c.tags_json, c.tag_signals_json, c.release_year,
      c.created_at, p.display_name AS submitter_display_name,
      l.provider, l.source_url, l.embed_url
    FROM catalogue c
    JOIN music_service_links l ON l.music_work_id = c.id AND l.availability_status != 'unavailable'
    LEFT JOIN profiles p ON p.id = c.submitted_by_profile_id
    ORDER BY ${rankOrder("c.id")}c.created_at DESC, c.id DESC, l.provider ASC`).bind(...(ranking.length ? [JSON.stringify(ranking)] : []), ...selectedGenres, ...selectedTags, ...searchBindings).all<MusicRow>();
  const works = new Map<string, MusicWork>();
  for (const row of result.results) {
    let work = works.get(row.id);
    if (!work) {
      const base = { title: row.title, artist: row.artist, description: row.description, genre: musicGenreLabel(row.genre), year: row.release_year };
      const tagSignals = rowTagSignals(row.tag_signals_json);
      work = { id: row.id, ...base, tagSignals: tagSignals.length ? tagSignals : inferMusicTagSignals({ ...base, tags: rowTags(row.tags_json) }),
        tags: effectiveMusicTags({ ...base, tags: rowTags(row.tags_json), tagSignals }),
        ...presentation(row.id, row.title, row.artist), source: "community",
        submittedBy: row.submitter_display_name ?? undefined, createdAt: row.created_at, services: [] };
      works.set(row.id, work);
    }
    work.services.push({ provider: row.provider, label: MUSIC_PROVIDER_LABELS[row.provider], url: row.source_url, embedUrl: row.embed_url ?? undefined });
  }
  const catalogue = canonicalizeMusicWorks([...works.values()]).filter(hasHubFullPlaybackSource);
  const total = catalogue.length;
  return { works: catalogue.slice(pageOffset, pageOffset + pageSize), total, nextOffset: Math.min(total, pageOffset + pageSize) };
}

export async function createD1MusicWork(database: D1Database, viewer: Pick<Profile, "id" | "displayName">, input: CreateMusicWorkInput, now = new Date()): Promise<MusicWork> {
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  const genre = musicGenreLabel(input.genre);
  const tagSignals = input.tagSignals?.length ? input.tagSignals : inferMusicTagSignals(input);
  const tags = normalizeTagList(effectiveMusicTags({ ...input, genre, tagSignals })).map((tag) => tag.display);
  const statements = [database.prepare(`INSERT INTO music_works
    (id, title, artist, description, genre, tags_json, tag_signals_json, release_year, submitted_by_profile_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).bind(id, input.title, input.artist, input.description, genre, JSON.stringify(tags), JSON.stringify(tagSignals), input.year, viewer.id, timestamp, timestamp)];
  for (const service of input.services) statements.push(database.prepare(`INSERT INTO music_service_links
    (id, music_work_id, provider, source_url, embed_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), id, service.provider, service.url, service.embedUrl ?? null, timestamp));
  await database.batch(statements);
  await indexD1ContentTags(database, "music_work", id, tags);
  /*
   * The stored counts move by this one work rather than being recomputed. A
   * full recount is 16,394 rows read; publishing a song should not cost that,
   * and the periodic refresh corrects any drift.
   */
  await bumpMusicTagFacets(database, tagSignals);
  return canonicalizeMusicWork({ id, title: input.title, artist: input.artist, description: input.description, genre, tags, tagSignals, year: input.year,
    ...presentation(id, input.title, input.artist), source: "community", submittedBy: viewer.displayName,
    createdAt: timestamp,
    services: input.services.map((service) => ({ provider: service.provider, label: service.label, url: service.url, embedUrl: service.embedUrl })) });
}

/*
 * Reads the stored answer. An empty table means the refresh has not run yet
 * — on a fresh database, or between the migration and the first cron — so it
 * falls back to counting rather than showing a screen with no way in.
 */
export async function listD1MusicTagFacets(database: D1Database, limit = 200): Promise<MusicTagFacet[]> {
  const capped = Math.max(1, Math.min(500, Math.trunc(limit)));
  try {
    const stored = await database.prepare(
      `SELECT tag, kind, count FROM music_tag_facets ORDER BY count DESC LIMIT ?`,
    ).bind(capped).all<{ tag: string; kind: string; count: number }>();
    if (stored.results.length) {
      return orderMusicTagFacets(stored.results.map((row) => ({
        tag: row.tag,
        kind: TAG_KIND_ORDER.includes(row.kind as MusicTagKind) ? row.kind as MusicTagKind : "feature",
        count: Number(row.count) || 0,
      })), capped);
    }
  } catch {
    /* The table arrives with migration 0159; before that, count. */
  }
  return computeMusicTagFacets(database, capped);
}

/** Recomputes the stored counts. Runs from maintenance, never from a page. */
export async function refreshMusicTagFacets(database: D1Database): Promise<{ tags: number }> {
  const facets = await computeMusicTagFacets(database, 500);
  await database.prepare(`DELETE FROM music_tag_facets`).run();
  const now = new Date().toISOString();
  for (let index = 0; index < facets.length; index += 50) {
    const chunk = facets.slice(index, index + 50);
    await database.batch(chunk.map((facet) => database
      .prepare(`INSERT OR REPLACE INTO music_tag_facets (tag, kind, count, updated_at) VALUES (?, ?, ?, ?)`)
      .bind(facet.tag, facet.kind, facet.count, now)));
  }
  return { tags: facets.length };
}

/** Adds one work's tags to the stored counts. A few rows, not a recount. */
async function bumpMusicTagFacets(database: D1Database, signals: MusicTagSignal[]): Promise<void> {
  const now = new Date().toISOString();
  const rows = signals.filter((signal) => signal.tag.trim().length > 0);
  if (!rows.length) return;
  try {
    await database.batch(rows.map((signal) => database.prepare(
      `INSERT INTO music_tag_facets (tag, kind, count, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(tag) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
    ).bind(signal.tag, signal.kind, now)));
  } catch {
    /* Before migration 0159 there is no table; the read path still counts. */
  }
}
