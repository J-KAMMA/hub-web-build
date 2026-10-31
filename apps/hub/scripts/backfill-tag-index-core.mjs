/*
 * Tag index backfill (2026-10-29). Re-normalises existing tag data with @jkamma/content-tags (NFKC + full case
 * folding, which SQLite cannot do) and brings content_tag_links in line with the per-kind source columns.
 *
 * It only READS through `db.all` and hands the statements it wants to run to `onBatch`; the caller decides whether
 * to apply them (a test database), write them to a .sql file for `wrangler d1 execute --local --file`, or
 * nothing at all (dry run). Idempotent: a second run over its own output plans nothing.
 *
 * Covers:
 *   1. content_tags whose normalized_key is not the current key of its display_name: renamed, or merged into the
 *      row that already owns the new key (links move, duplicate links drop, use_count recomputed).
 *   2. content_tag_links for user articles, music works, videos (category and topic), market products and
 *      classified listings, from tags_json / genre / category. Missing links are added, stale ones removed.
 *      Items keep at most 8 index tags; tags_json itself is never rewritten here (over-limit tags stay stored and
 *      are trimmed on the next edit).
 *   3. hub_article_tag_follows.tag_key.
 * Counts only. Never returns or prints tag text.
 */
import { createHash } from "node:crypto";

import { normalizeTag, normalizeTagList } from "../../../packages/content-tags/src/index.ts";

const IN_CHUNK = 80;

function tagId(key) {
  return `tag_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function parseTags(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function videoTagInput(category, topic) {
  return [category ?? "", topic && topic !== "未分類" ? topic : ""];
}

/** Sources of index tags. `inputs(row)` returns raw strings; order matters (first 8 valid unique win). */
const SOURCES = [
  {
    targetType: "user_article", label: "articles", table: "hub_user_articles",
    columns: "id, tags_json, created_at", inputs: (row) => parseTags(row.tags_json),
  },
  {
    targetType: "music_work", label: "music", table: "music_works",
    columns: "id, tags_json, genre, created_at", inputs: (row) => [...parseTags(row.tags_json), row.genre],
  },
  {
    targetType: "video", label: "videos", table: "external_videos",
    columns: "id, category, topic, created_at", inputs: (row) => videoTagInput(row.category, row.topic),
  },
  {
    targetType: "market_product", label: "market", table: "market_products",
    columns: "id, tags_json, created_at", inputs: (row) => parseTags(row.tags_json), optional: true,
  },
  {
    targetType: "classified", label: "classified", table: "classified_listings",
    columns: "id, tags_json, created_at", inputs: (row) => parseTags(row.tags_json), optional: true,
  },
];

function isMissing(error) {
  return error instanceof Error && /no such (table|column)/i.test(error.message);
}

/**
 * @param {{ all: (sql: string, params?: unknown[]) => Promise<any[]> | any[] }} db
 * @param {{ dryRun?: boolean, batchSize?: number, now?: string, onBatch?: (statements: Array<{sql: string, params: unknown[]}>) => Promise<void> | void }} options
 */
export async function runTagBackfill(db, options = {}) {
  const batchSize = Math.max(50, Math.min(2000, Math.trunc(options.batchSize ?? 500)));
  const now = options.now ?? new Date().toISOString();
  const counts = {
    tagsRenamed: 0, tagsMerged: 0, tagsSkippedInvalid: 0,
    linksAdded: {}, linksRemoved: {}, followsKeyed: 0, statements: 0,
  };
  const pending = [];
  const emit = async (sql, params = []) => {
    pending.push({ sql, params });
    counts.statements += 1;
    if (pending.length >= batchSize) await flush();
  };
  async function flush() {
    if (!pending.length) return;
    const batch = pending.splice(0, pending.length);
    if (!options.dryRun && options.onBatch) await options.onBatch(batch);
  }

  // ---- 1. content_tags: re-key and merge ----------------------------------------------------------
  const finalIdOfTag = new Map(); // tag id -> id that now holds its links (merged rows)
  const finalKeyOfTag = new Map(); // tag id -> key after this run
  const owners = new Map(); // key -> tag id decided in this run
  const renames = [];
  const merges = [];
  const touchedOwners = new Set();
  let lastId = "";
  for (;;) {
    const page = await db.all(
      "SELECT id, normalized_key, display_name FROM content_tags WHERE id > ? ORDER BY id LIMIT ?",
      [lastId, batchSize * 4],
    );
    if (!page.length) break;
    lastId = page[page.length - 1].id;
    for (const row of page) {
      const tag = normalizeTag(row.display_name);
      finalKeyOfTag.set(row.id, row.normalized_key);
      if (!tag) { counts.tagsSkippedInvalid += 1; owners.set(row.normalized_key, owners.get(row.normalized_key) ?? row.id); continue; }
      if (tag.key === row.normalized_key) { owners.set(tag.key, owners.get(tag.key) ?? row.id); continue; }
      let owner = owners.get(tag.key);
      if (owner === undefined) {
        const found = await db.all("SELECT id FROM content_tags WHERE normalized_key = ? LIMIT 1", [tag.key]);
        owner = found[0]?.id;
      }
      if (owner !== undefined && owner !== row.id) {
        merges.push({ from: row.id, to: owner });
        finalIdOfTag.set(row.id, owner);
        finalKeyOfTag.set(row.id, tag.key);
        touchedOwners.add(owner);
        counts.tagsMerged += 1;
      } else {
        renames.push({ id: row.id, key: tag.key, display: tag.display });
        owners.set(tag.key, row.id);
        finalKeyOfTag.set(row.id, tag.key);
        counts.tagsRenamed += 1;
      }
    }
  }
  for (const merge of merges) {
    await emit("UPDATE OR IGNORE content_tag_links SET tag_id = ? WHERE tag_id = ?", [merge.to, merge.from]);
    await emit("DELETE FROM content_tag_links WHERE tag_id = ?", [merge.from]);
    await emit("DELETE FROM content_tags WHERE id = ?", [merge.from]);
  }
  // Two phases so a swap of keys cannot trip the UNIQUE constraint half way.
  for (const rename of renames) await emit("UPDATE content_tags SET normalized_key = ? WHERE id = ?", [`~rekey~${rename.id}`, rename.id]);
  for (const rename of renames) await emit("UPDATE content_tags SET normalized_key = ?, display_name = ? WHERE id = ?", [rename.key, rename.display, rename.id]);

  // ---- 2. links per kind ----------------------------------------------------------------------------
  for (const source of SOURCES) {
    counts.linksAdded[source.label] = 0;
    counts.linksRemoved[source.label] = 0;
    let after = "";
    for (;;) {
      let rows;
      try {
        rows = await db.all(`SELECT ${source.columns} FROM ${source.table} WHERE id > ? ORDER BY id LIMIT ?`, [after, batchSize]);
      } catch (error) {
        if (source.optional && isMissing(error)) break;
        throw error;
      }
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      const existing = new Map(); // target id -> Map(key -> tag id)
      for (let offset = 0; offset < rows.length; offset += IN_CHUNK) {
        const ids = rows.slice(offset, offset + IN_CHUNK).map((row) => row.id);
        const links = await db.all(
          `SELECT l.target_id, l.tag_id FROM content_tag_links l WHERE l.target_type = ? AND l.target_id IN (${ids.map(() => "?").join(",")})`,
          [source.targetType, ...ids],
        );
        for (const link of links) {
          const tagIdNow = finalIdOfTag.get(link.tag_id) ?? link.tag_id;
          let key = finalKeyOfTag.get(link.tag_id);
          if (key === undefined) {
            const stored = await db.all("SELECT normalized_key FROM content_tags WHERE id = ?", [link.tag_id]);
            key = stored[0]?.normalized_key ?? "";
          }
          if (!existing.has(link.target_id)) existing.set(link.target_id, new Map());
          existing.get(link.target_id).set(key, tagIdNow);
        }
      }
      for (const row of rows) {
        const desired = normalizeTagList(source.inputs(row));
        const have = existing.get(row.id) ?? new Map();
        const wanted = new Set(desired.map((tag) => tag.key));
        for (const tag of desired) {
          if (have.has(tag.key)) continue;
          const id = tagId(tag.key);
          await emit(
            "INSERT INTO content_tags(id, normalized_key, display_name, created_at, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(normalized_key) DO NOTHING",
            [id, tag.key, tag.display, now, now],
          );
          await emit(
            "INSERT OR IGNORE INTO content_tag_links(tag_id, target_type, target_id, created_at) SELECT id, ?, ?, ? FROM content_tags WHERE normalized_key = ?",
            [source.targetType, row.id, row.created_at ?? now, tag.key],
          );
          counts.linksAdded[source.label] += 1;
        }
        for (const [key, id] of have) {
          if (wanted.has(key)) continue;
          await emit("DELETE FROM content_tag_links WHERE tag_id = ? AND target_type = ? AND target_id = ?", [id, source.targetType, row.id]);
          counts.linksRemoved[source.label] += 1;
        }
      }
    }
  }

  // use_count follows merges (UPDATE OR IGNORE does not fire the insert trigger).
  const owned = [...touchedOwners];
  for (let offset = 0; offset < owned.length; offset += IN_CHUNK) {
    const chunk = owned.slice(offset, offset + IN_CHUNK);
    await emit(
      `UPDATE content_tags SET use_count = (SELECT COUNT(*) FROM content_tag_links l WHERE l.tag_id = content_tags.id AND l.public_visible = 1) WHERE id IN (${chunk.map(() => "?").join(",")})`,
      chunk,
    );
  }

  // ---- 3. follow keys ---------------------------------------------------------------------------------
  try {
    let cursor = ["", ""];
    for (;;) {
      const rows = await db.all(
        "SELECT profile_id, tag FROM hub_article_tag_follows WHERE tag_key IS NULL AND (profile_id > ? OR (profile_id = ? AND tag > ?)) ORDER BY profile_id, tag LIMIT ?",
        [cursor[0], cursor[0], cursor[1], batchSize],
      );
      if (!rows.length) break;
      cursor = [rows[rows.length - 1].profile_id, rows[rows.length - 1].tag];
      for (const row of rows) {
        const tag = normalizeTag(row.tag);
        if (!tag) continue;
        await emit("UPDATE hub_article_tag_follows SET tag_key = ? WHERE profile_id = ? AND tag = ? AND tag_key IS NULL", [tag.key, row.profile_id, row.tag]);
        counts.followsKeyed += 1;
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  await flush();
  return counts;
}

/** Inline parameters as SQL literals (for a .sql file). Numbers and strings only. */
export function statementToSql({ sql, params }) {
  let index = 0;
  return `${sql.replace(/\?/g, () => {
    const value = params[index++];
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  })};`;
}
