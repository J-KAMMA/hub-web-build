import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { normalizeTag, normalizeTagList, tagKey } from "@jkamma/content-tags";
import {
  CONTENT_TAG_CLASSIFIER_VERSION,
  sanitizeContentTagSignals,
  type ContentTagSignal,
} from "@/lib/content-tagging";

export type ContentTagTargetType =
  | "social_post" | "thread" | "hubpedia_article" | "community_post"
  | "video" | "music" | "product" | "work" | "classified"
  | "user_article" | "music_work" | "market_product";

export interface ContentTagSummary { name: string; key: string; useCount: number }
export interface TrendingContentTagSummary {
  name: string;
  key: string;
  recentCount: number;
  totalCount: number;
  score: number;
}
export interface StoredContentTagSignal extends ContentTagSignal { key: string }

function normalizedSignals(input: unknown): ContentTagSignal[] {
  if (Array.isArray(input) && input.some((item) => item && typeof item === "object")) {
    return sanitizeContentTagSignals(input.filter((item): item is ContentTagSignal => {
      if (!item || typeof item !== "object") return false;
      const value = item as Partial<ContentTagSignal>;
      return typeof value.tag === "string" && typeof value.kind === "string" && typeof value.confidence === "number"
        && typeof value.provenance === "string" && typeof value.basis === "string" && typeof value.classifierVersion === "string";
    }));
  }
  return normalizeTagList(Array.isArray(input) ? input : []).map(({ display: tag }) => ({
    tag, kind: "manual", confidence: 1, provenance: "publisher",
    basis: "publisher-supplied", classifierVersion: CONTENT_TAG_CLASSIFIER_VERSION,
  }));
}

/** Keep one signal per tag key (first wins) and drop tags the shared normaliser rejects. */
function keyedSignals(signals: ContentTagSignal[]): Array<ContentTagSignal & { key: string }> {
  const seen = new Set<string>();
  const out: Array<ContentTagSignal & { key: string }> = [];
  for (const signal of signals) {
    const tag = normalizeTag(signal.tag);
    if (!tag || seen.has(tag.key)) continue;
    seen.add(tag.key);
    out.push({ ...signal, tag: tag.display, key: tag.key });
  }
  return out;
}

/**
 * Statements that replace a target's tag links. Callers that write the target itself put these in the same
 * batch so the row and its tags land together.
 */
export async function buildD1ContentTagStatements(
  database: D1Database,
  targetType: ContentTagTargetType,
  targetId: string,
  input: unknown,
): Promise<{ statements: D1PreparedStatement[]; tags: string[] }> {
  const signals = keyedSignals(normalizedSignals(input));
  const tags = signals.map((item) => item.tag);
  const now = new Date().toISOString();
  // public_visible is set by the content_tag_link_after_insert trigger (migration 0286) from the target's
  // current state, so a link for a gated or hidden target is created invisible in the same statement.
  const statements = [database.prepare("DELETE FROM content_tag_links WHERE target_type=? AND target_id=?").bind(targetType, targetId)];
  for (const item of signals) {
    const displayName = item.tag;
    const key = item.key;
    const id = `tag_${await stableTagDigest(key)}`;
    statements.push(
      database.prepare(`INSERT INTO content_tags(id,normalized_key,display_name,created_at,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(normalized_key) DO UPDATE SET updated_at=excluded.updated_at`)
        .bind(id, key, displayName, now, now),
      database.prepare(`INSERT OR REPLACE INTO content_tag_links(
          tag_id,target_type,target_id,created_at,tag_kind,confidence,provenance,generation_basis,classifier_version
        ) SELECT id,?,?,?,?,?,?,?,? FROM content_tags WHERE normalized_key=?`)
        .bind(targetType, targetId, now, item.kind, item.confidence, item.provenance, item.basis, item.classifierVersion, key),
    );
  }
  return { statements, tags };
}

/** One batch (atomic on D1); falls back to sequential runs only for minimal test doubles that lack batch(). */
export async function runD1Statements(database: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (typeof database.batch === "function") await database.batch(statements);
  else for (const statement of statements) await statement.run();
}

/**
 * Tag index for a row that was just written. The row is the source of record (tags_json); a failure here must not
 * fail or duplicate the write, so it is logged without tag text and left for scripts/backfill-tag-index.mjs.
 */
export async function indexD1ContentTags(
  database: D1Database,
  targetType: ContentTagTargetType,
  targetId: string,
  input: unknown,
): Promise<void> {
  try {
    await replaceD1ContentTags(database, targetType, targetId, input);
  } catch {
    console.error("content_tag_index_failed", targetType);
  }
}

export async function replaceD1ContentTags(
  database: D1Database,
  targetType: ContentTagTargetType,
  targetId: string,
  input: unknown,
): Promise<string[]> {
  const { statements, tags } = await buildD1ContentTagStatements(database, targetType, targetId, input);
  await runD1Statements(database, statements);
  return tags;
}

/** Category and topic of an external or Hub video, as tags (videos have no free tag field). */
export function videoCategoryTagInput(category: string | null | undefined, topic: string | null | undefined): string[] {
  return normalizeTagList([category ?? "", topic && topic !== "未分類" ? topic : ""]).map((tag) => tag.display);
}

export async function listD1ContentTagSignals(
  database: D1Database,
  targetType: ContentTagTargetType,
  targetId: string,
): Promise<StoredContentTagSignal[]> {
  const result = await database.prepare(`SELECT t.display_name,t.normalized_key,l.tag_kind,l.confidence,
      l.provenance,l.generation_basis,l.classifier_version
    FROM content_tag_links l JOIN content_tags t ON t.id=l.tag_id
    WHERE l.target_type=? AND l.target_id=?
    ORDER BY l.confidence DESC,t.display_name ASC`)
    .bind(targetType, targetId)
    .all<{ display_name: string; normalized_key: string; tag_kind: string; confidence: number; provenance: ContentTagSignal["provenance"]; generation_basis: string; classifier_version: string }>();
  return result.results.map((row) => ({
    tag: row.display_name, key: row.normalized_key, kind: row.tag_kind,
    confidence: Number(row.confidence), provenance: row.provenance,
    basis: row.generation_basis, classifierVersion: row.classifier_version,
  }));
}

export async function attachD1ContentTags<T extends { id: string; tags?: string[] }>(
  database: D1Database,
  targetType: ContentTagTargetType,
  targets: T[],
): Promise<void> {
  if (!targets.length) return;
  const byId = new Map(targets.map((target) => [target.id, target]));
  for (const target of targets) target.tags = [];
  for (let offset = 0; offset < targets.length; offset += 80) {
    const chunk = targets.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await database.prepare(`SELECT l.target_id,t.display_name
      FROM content_tag_links l JOIN content_tags t ON t.id=l.tag_id
      WHERE l.target_type=? AND l.target_id IN (${placeholders})
      ORDER BY t.use_count DESC,t.display_name ASC`)
      .bind(targetType, ...chunk.map((target) => target.id))
      .all<{ target_id: string; display_name: string }>();
    for (const row of result.results) byId.get(row.target_id)?.tags?.push(row.display_name);
  }
}

/** Prefix of a key the user is typing: like tagKey but accepts a partial or over-long string. */
function tagKeyPrefix(query: string): string {
  return tagKey(query.slice(0, 64)) ?? "";
}

const PUBLIC_LINK_JOIN = "LEFT JOIN social_posts sp ON l.target_type='social_post' AND sp.id=l.target_id";
const PUBLIC_LINK_WHERE = `l.public_visible=1 AND (l.target_type<>'social_post' OR (sp.id IS NOT NULL AND sp.moderated_at IS NULL AND sp.audience='public'))
  AND NOT EXISTS (SELECT 1 FROM content_access_gates cag WHERE cag.target_id=l.target_id
    AND cag.target_type=CASE l.target_type WHEN 'social_post' THEN 'post' WHEN 'user_article' THEN 'article' ELSE l.target_type END)`;

export async function listD1PopularContentTags(database: D1Database, limit = 20, query = ""): Promise<ContentTagSummary[]> {
  const normalized = tagKeyPrefix(query);
  // 候補は公開で鍵なし・非表示でない項目に付いたタグだけ。鍵つき投稿のタグ名や件数を出さない。
  // 前方一致の % _ \ は文字そのものとして扱う（ESCAPE）。
  const escaped = normalized.replace(/[\\%_]/g, (char) => `\\${char}`);
  const result = await database.prepare(`SELECT t.display_name,t.normalized_key,
      (SELECT COUNT(*) FROM content_tag_links l ${PUBLIC_LINK_JOIN} WHERE l.tag_id=t.id AND ${PUBLIC_LINK_WHERE}) AS use_count
    FROM content_tags t
    WHERE (?='' OR t.normalized_key LIKE ? || '%' ESCAPE '\\')
      AND EXISTS (SELECT 1 FROM content_tag_links l ${PUBLIC_LINK_JOIN} WHERE l.tag_id=t.id AND ${PUBLIC_LINK_WHERE})
    ORDER BY use_count DESC,t.updated_at DESC LIMIT ?`)
    .bind(normalized, escaped, Math.max(1, Math.min(50, limit)))
    .all<{ display_name: string; normalized_key: string; use_count: number }>();
  return result.results.map((row) => ({ name: row.display_name, key: row.normalized_key, useCount: Number(row.use_count) }));
}

export async function listD1TrendingContentTags(
  database: D1Database,
  limit = 12,
  now = new Date(),
): Promise<TrendingContentTagSummary[]> {
  const recentDay = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recentThreeDays = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const recentWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await database.prepare(`
    SELECT
      t.display_name,
      t.normalized_key,
      COUNT(DISTINCT l.target_type || ':' || l.target_id) AS total_count,
      COUNT(DISTINCT CASE WHEN l.created_at >= ? THEN l.target_type || ':' || l.target_id END) AS recent_count,
      SUM(
        l.confidence * CASE
          WHEN l.created_at >= ? THEN 4
          WHEN l.created_at >= ? THEN 2
          ELSE 1
        END
      ) AS trend_score
    FROM content_tag_links l
    JOIN content_tags t ON t.id = l.tag_id
    LEFT JOIN social_posts social
      ON l.target_type = 'social_post' AND social.id = l.target_id
    WHERE l.created_at >= ?
      AND l.confidence >= 0.6
      AND l.public_visible = 1
      AND l.target_type IN ('social_post', 'thread', 'community_post')
      AND (
        l.target_type <> 'social_post'
        OR (social.id IS NOT NULL AND social.moderated_at IS NULL AND social.audience = 'public')
      )
      AND NOT EXISTS (
        SELECT 1 FROM content_access_gates gate
        WHERE gate.target_id = l.target_id
          AND gate.target_type = CASE l.target_type WHEN 'social_post' THEN 'post' ELSE l.target_type END
      )
    GROUP BY t.id, t.display_name, t.normalized_key
    HAVING recent_count > 0
    ORDER BY trend_score DESC, recent_count DESC, total_count DESC, t.updated_at DESC
    LIMIT ?
  `)
    .bind(
      recentDay,
      recentDay,
      recentThreeDays,
      recentWeek,
      Math.max(1, Math.min(30, Math.trunc(limit))),
    )
    .all<{
      display_name: string;
      normalized_key: string;
      recent_count: number;
      total_count: number;
      trend_score: number;
    }>();

  return result.results.map((row) => ({
    name: row.display_name,
    key: row.normalized_key,
    recentCount: Number(row.recent_count),
    totalCount: Number(row.total_count),
    score: Number(Number(row.trend_score).toFixed(1)),
  }));
}

async function stableTagDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
