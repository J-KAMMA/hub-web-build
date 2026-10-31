import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  HUB_EVIDENCE_KINDS,
  evaluateHubItem,
  limitQuote,
  type HubEvidenceKind,
} from "@/lib/server/hubpedia-hub-evidence";

/*
 * Topic candidates found in public Hub activity (docs/hubpedia-hybrid/DESIGN.md
 * sections 2 and 7, phase 2).
 *
 * The rule that keeps this from becoming scaled content: a topic becomes a
 * candidate only when public material from at least three different authors
 * and at least two different families of item (post, thread, research,
 * article, video, music, community) points at it. One person's posts never
 * make an entry. Material counts only if evaluateHubItem() says so, which is
 * also what enforces the public-only rule and every opt-out; this module has
 * no second copy of those rules and never reads an item any other way.
 *
 * Everything is deterministic: tags, shared links and shared video/music
 * references, and a small amount of term overlap. No model is called.
 *
 * Cost shape (D1 bills rows read): each run reads at most `batchPerKind` ids
 * per kind after a persisted keyset cursor, indexes the signals of the items
 * that are usable material, and then looks only at the signal keys those items
 * touched. There is no OFFSET and no walk over the whole activity tables.
 */

export const HUB_TOPIC_MIN_AUTHORS = 3;
export const HUB_TOPIC_MIN_KIND_FAMILIES = 2;
export const HUB_TOPIC_DEFAULT_BATCH_PER_KIND = 25;
export const HUB_TOPIC_MAX_BATCH_PER_KIND = 100;
export const HUB_TOPIC_DEFAULT_MAX_CANDIDATES = 5;
/* Members kept per candidate; the cluster may be larger. */
export const HUB_TOPIC_MEMBER_LIMIT = 60;
const MEMBER_ROWS_PER_KEY = 200;
const KEYS_EVALUATED_PER_RUN = 60;
const IN_LIST_CHUNK = 50;
const OVERLAP_THRESHOLD = 0.5;

export const HUB_TOPIC_SCAN_KINDS: readonly HubEvidenceKind[] = HUB_EVIDENCE_KINDS;

/**
 * "Kind" for the two-kinds rule. A thread and a reply inside a thread are the
 * same sort of material, so they count once.
 */
export function kindFamily(kind: HubEvidenceKind) {
  switch (kind) {
    case "thread":
    case "thread_post":
      return "thread";
    case "channel_message":
      return "community";
    case "research_version":
      return "research";
    case "music_work":
      return "music";
    default:
      return kind;
  }
}

/* ---------------------------------------------------------------- signals */

const LATIN_STOPWORDS = new Set([
  "http", "https", "www", "this", "that", "with", "from", "have", "your", "about", "there", "their", "what",
  "when", "where", "which", "would", "could", "should", "just", "like", "more", "some", "than", "then",
  "them", "they", "will", "been", "were", "into", "also", "only", "very", "much", "many", "most", "such",
  "here", "does", "doing", "done", "being", "after", "before", "because", "these", "those", "other",
]);

const MAX_TAG_SIGNALS = 10;
const MAX_URL_SIGNALS = 3;
const MAX_TERM_SIGNALS = 5;

function normalizeKeyPart(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/gu, "");
}

function pushUnique(target: string[], key: string, cap: number, counter: { n: number }) {
  if (counter.n >= cap || key.length > 190 || target.includes(key)) return;
  target.push(key);
  counter.n += 1;
}

/**
 * Canonical key for a shared link, or null when the link is too generic to
 * bind anything (a bare site root). YouTube links collapse to the video id so
 * watch, share and embed forms of one video meet.
 */
export function normalizeLinkSignal(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id ? `url:youtube/${id}` : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const id = url.searchParams.get("v") ?? (/^\/(?:embed|shorts|live)\/([^/?#]+)/u.exec(url.pathname)?.[1] ?? null);
    return id ? `url:youtube/${id}` : null;
  }
  const path = url.pathname.replace(/\/+$/u, "");
  if (path.length < 2) return null;
  return `url:${host}${path}`;
}

/** Hashtags, shared links and informative terms found in one item's text. Pure. */
export function extractTextSignals(text: string): { tags: string[]; links: string[]; terms: string[] } {
  const normalized = text.normalize("NFKC");
  const tags: string[] = [];
  const tagCount = { n: 0 };
  for (const match of normalized.matchAll(/(?:^|[\s、。(「『])[#＃]([\p{L}\p{N}_ー]{2,40})/gu)) {
    pushUnique(tags, `tag:${normalizeKeyPart(match[1])}`, MAX_TAG_SIGNALS, tagCount);
  }
  const links: string[] = [];
  const linkCount = { n: 0 };
  for (const match of normalized.matchAll(/https?:\/\/[^\s<>"'）)」』、。]+/giu)) {
    const key = normalizeLinkSignal(match[0]);
    if (key) pushUnique(links, key, MAX_URL_SIGNALS, linkCount);
  }

  const bare = normalized
    .replace(/https?:\/\/[^\s<>"'）)」』、。]+/giu, " ")
    .replace(/[#＃][\p{L}\p{N}_ー]+/gu, " ");
  const frequency = new Map<string, number>();
  const bump = (term: string) => frequency.set(term, (frequency.get(term) ?? 0) + 1);
  for (const match of bare.matchAll(/\b[A-Za-z][A-Za-z0-9]{3,29}\b/gu)) {
    const term = match[0].toLowerCase();
    if (!LATIN_STOPWORDS.has(term)) bump(term);
  }
  for (const match of bare.matchAll(/[ァ-ヺー]{4,20}/gu)) bump(match[0]);
  for (const match of bare.matchAll(/[一-鿿々]{3,10}/gu)) bump(match[0]);
  const terms = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_TERM_SIGNALS)
    .map(([term]) => `term:${term}`);
  return { tags, links, terms };
}

const TAG_TARGET: Partial<Record<HubEvidenceKind, string>> = {
  post: "social_post",
  thread: "thread",
  video: "video",
  music_work: "music",
};

async function storedTagSignals(db: D1Database, kind: HubEvidenceKind, id: string) {
  let target = TAG_TARGET[kind] ?? null;
  let targetId = id;
  if (kind === "thread_post") {
    const row = await db.prepare("SELECT thread_id AS threadId FROM thread_posts WHERE id = ?").bind(id).first<{ threadId: string }>();
    if (!row) return [];
    target = "thread";
    targetId = row.threadId;
  }
  if (!target) return [];
  const rows = await db
    .prepare(
      `SELECT t.normalized_key AS key
       FROM content_tag_links l JOIN content_tags t ON t.id = l.tag_id
       WHERE l.target_type = ? AND l.target_id = ? AND l.confidence >= 0.7
       ORDER BY t.normalized_key LIMIT ${MAX_TAG_SIGNALS}`,
    )
    .bind(target, targetId)
    .all<{ key: string }>();
  return rows.results.map((row) => `tag:${normalizeKeyPart(row.key)}`);
}

/** Every signal key of one usable item. The text is already known to be public material. */
export async function itemSignalKeys(db: D1Database, kind: HubEvidenceKind, id: string, text: string) {
  const found = extractTextSignals(text);
  const keys: string[] = [];
  const add = (key: string) => {
    if (key.length <= 190 && key.length >= 3 && !keys.includes(key)) keys.push(key);
  };
  for (const key of await storedTagSignals(db, kind, id)) add(key);
  found.tags.forEach(add);
  found.links.forEach(add);
  if (kind === "video") add(`video:${id}`);
  if (kind === "music_work") add(`music:${id}`);
  if (kind === "post") {
    const video = await db.prepare("SELECT video_id AS id FROM social_post_video_refs WHERE post_id = ?").bind(id).first<{ id: string }>();
    if (video) add(`video:${video.id}`);
    const music = await db.prepare("SELECT work_id AS id FROM social_post_music_refs WHERE post_id = ?").bind(id).first<{ id: string }>();
    if (music) add(`music:${music.id}`);
  }
  found.terms.forEach(add);
  return keys;
}

/* ------------------------------------------------------------ scanning */

const SCAN_SQL: Record<HubEvidenceKind, string> = {
  post: "SELECT id FROM social_posts WHERE id > ? ORDER BY id LIMIT ?",
  thread: "SELECT id FROM threads WHERE id > ? ORDER BY id LIMIT ?",
  thread_post: "SELECT id FROM thread_posts WHERE id > ? ORDER BY id LIMIT ?",
  channel_message: "SELECT id FROM community_channel_messages WHERE id > ? ORDER BY id LIMIT ?",
  research_version: "SELECT id FROM research_document_revisions WHERE id > ? ORDER BY id LIMIT ?",
  article: "SELECT id FROM hub_user_articles WHERE id > ? ORDER BY id LIMIT ?",
  video: "SELECT id FROM external_videos WHERE id > ? ORDER BY id LIMIT ?",
  music_work: "SELECT id FROM music_works WHERE id > ? ORDER BY id LIMIT ?",
};

type Pending = { kind: HubEvidenceKind; itemId: string; author: string; keys: string[] };
type Member = { kind: HubEvidenceKind; itemId: string; author: string; text: string | null };

function chunked<T>(items: readonly T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function readCursor(db: D1Database, kind: HubEvidenceKind) {
  const row = await db
    .prepare("SELECT cursor FROM hubpedia_hub_topic_scan_cursor WHERE kind = ?")
    .bind(kind)
    .first<{ cursor: string }>();
  return row?.cursor ?? "";
}

async function writeCursor(db: D1Database, kind: HubEvidenceKind, cursor: string, now: Date) {
  await db
    .prepare(
      `INSERT INTO hubpedia_hub_topic_scan_cursor(kind, cursor, updated_at) VALUES(?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
    )
    .bind(kind, cursor, now.toISOString())
    .run();
}

async function clearItemSignals(db: D1Database, kind: HubEvidenceKind, id: string) {
  await db.prepare("DELETE FROM hubpedia_hub_topic_signals WHERE kind = ? AND item_id = ?").bind(kind, id).run();
}

async function replaceItemSignals(db: D1Database, item: Pending, now: Date) {
  await clearItemSignals(db, item.kind, item.itemId);
  for (const key of item.keys) {
    await db
      .prepare(
        `INSERT INTO hubpedia_hub_topic_signals(signal_key, kind, item_id, author_profile_id, observed_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(signal_key, kind, item_id) DO UPDATE SET author_profile_id = excluded.author_profile_id, observed_at = excluded.observed_at`,
      )
      .bind(key, item.kind, item.itemId, item.author, now.toISOString())
      .run();
  }
}

/* ----------------------------------------------------- existing coverage */

/**
 * True when Hubpedia already has an entry for the label, so the topic would
 * duplicate it. Only the database is consulted here; callers that also hold
 * the code-based catalog pass a wider check to the scan.
 */
export function databaseCoverageCheck(db: D1Database) {
  return async (label: string) => {
    const lower = label.normalize("NFKC").toLocaleLowerCase("ja");
    const row = await db
      .prepare(
        `SELECT 1 AS found FROM encyclopedia_topics WHERE lower(canonical_name) = ?1 OR slug = ?1
         UNION ALL SELECT 1 FROM encyclopedia_articles WHERE lower(title) = ?1 OR slug = ?1
         UNION ALL SELECT 1 FROM encyclopedia_article_revisions r, json_each(r.generation_metadata, '$.aliases') j
           WHERE json_valid(r.generation_metadata) AND lower(j.value) = ?1
         LIMIT 1`,
      )
      .bind(lower)
      .first<{ found: number }>();
    return Boolean(row);
  };
}

/* ---------------------------------------------------------------- the run */

export type HubTopicSkipReason =
  | "below_threshold"
  | "covered_by_existing_article"
  | "label_too_short"
  | "already_a_candidate"
  | "overlaps_selected_topic"
  | "overlaps_existing_candidate"
  | "no_anchor_post"
  | "anchor_already_candidate"
  | "write_conflict";

export type HubTopicPlanEntry = {
  signalKey: string;
  label: string;
  authors: number;
  kindFamilies: string[];
  items: Array<{ kind: HubEvidenceKind; itemId: string }>;
  anchor: { sourceType: "social_post" | "thread_post"; sourceId: string } | null;
};

export type HubTopicScanResult = {
  dryRun: boolean;
  scanned: Record<string, number>;
  indexed: number;
  removed: number;
  keysTouched: number;
  keysEvaluated: number;
  /** Candidates created, or, in a dry run, candidates that would be created. */
  candidates: Array<HubTopicPlanEntry & { candidateId: string | null }>;
  skipped: Array<{ signalKey: string; reason: HubTopicSkipReason }>;
  cursors: Record<string, string>;
};

export type HubTopicScanOptions = {
  batchPerKind?: number;
  maxCandidates?: number;
  kinds?: readonly HubEvidenceKind[];
  /** Plan only: reads, never writes (no signals, no cursor, no candidates). */
  dryRun?: boolean;
  isCovered?: (label: string) => Promise<boolean>;
};

function labelFor(key: string, members: Member[]) {
  const [prefix, ...rest] = key.split(":");
  const tail = rest.join(":");
  if (prefix === "video" || prefix === "music") {
    const kind: HubEvidenceKind = prefix === "video" ? "video" : "music_work";
    const holder = members.find((member) => member.kind === kind && member.itemId === tail);
    const first = holder?.text?.split("\n").map((line) => line.trim()).find(Boolean);
    if (first) return Array.from(first).slice(0, 160).join("");
  }
  return Array.from(tail).slice(0, 160).join("");
}

function interleaveByFamily(rows: Array<{ kind: HubEvidenceKind; itemId: string; author: string }>) {
  const lanes = new Map<string, typeof rows>();
  for (const row of rows) lanes.set(kindFamily(row.kind), [...(lanes.get(kindFamily(row.kind)) ?? []), row]);
  const ordered = [...lanes.keys()].sort();
  const out: typeof rows = [];
  for (let index = 0; out.length < rows.length; index += 1) {
    for (const family of ordered) {
      const row = lanes.get(family)?.[index];
      if (row) out.push(row);
    }
  }
  return out;
}

async function loadAnchor(db: D1Database, members: Member[]) {
  const order: HubEvidenceKind[] = ["post", "thread", "thread_post"];
  const anchorable = members
    .filter((member) => order.includes(member.kind))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.itemId < b.itemId ? -1 : 1));
  if (!anchorable.length) return { anchor: null, reason: "no_anchor_post" as const };
  for (const member of anchorable) {
    let sourceType: "social_post" | "thread_post" = member.kind === "post" ? "social_post" : "thread_post";
    let sourceId = member.itemId;
    if (member.kind === "thread") {
      const first = await db
        .prepare("SELECT id FROM thread_posts WHERE thread_id = ? ORDER BY post_no LIMIT 1")
        .bind(member.itemId)
        .first<{ id: string }>();
      if (!first) continue;
      sourceType = "thread_post";
      sourceId = first.id;
    }
    const taken = await db
      .prepare("SELECT 1 AS found FROM hubpedia_article_candidates WHERE source_type = ? AND source_id = ?")
      .bind(sourceType, sourceId)
      .first();
    if (!taken) return { anchor: { sourceType, sourceId, member }, reason: null };
  }
  return { anchor: null, reason: "anchor_already_candidate" as const };
}

/**
 * One bounded step of topic detection. Safe to call repeatedly; the cursor
 * lives in D1 so successive runs continue where the last stopped.
 */
export async function runHubTopicScan(
  db: D1Database,
  options: HubTopicScanOptions = {},
  now: Date = new Date(),
): Promise<HubTopicScanResult> {
  const batch = Math.max(1, Math.min(HUB_TOPIC_MAX_BATCH_PER_KIND, Math.trunc(options.batchPerKind ?? HUB_TOPIC_DEFAULT_BATCH_PER_KIND)));
  const maxCandidates = Math.max(0, Math.min(20, Math.trunc(options.maxCandidates ?? HUB_TOPIC_DEFAULT_MAX_CANDIDATES)));
  const dryRun = options.dryRun === true;
  const kinds = options.kinds ?? HUB_TOPIC_SCAN_KINDS;
  const isCovered = options.isCovered ?? databaseCoverageCheck(db);
  const result: HubTopicScanResult = {
    dryRun, scanned: {}, indexed: 0, removed: 0, keysTouched: 0, keysEvaluated: 0, candidates: [], skipped: [], cursors: {},
  };

  /* 1. Index the next batch of each kind. */
  const pending: Pending[] = [];
  for (const kind of kinds) {
    const cursor = await readCursor(db, kind);
    const ids = (await db.prepare(SCAN_SQL[kind]).bind(cursor, batch).all<{ id: string }>()).results.map((row) => row.id);
    result.scanned[kind] = ids.length;
    for (const id of ids) {
      const item = await evaluateHubItem(db, kind, id);
      if (!item.eligible) {
        if (!dryRun) await clearItemSignals(db, kind, id);
        result.removed += 1;
        continue;
      }
      const entry: Pending = { kind, itemId: id, author: item.authorProfileId, keys: await itemSignalKeys(db, kind, id, item.text) };
      pending.push(entry);
      if (!dryRun) await replaceItemSignals(db, entry, now);
      result.indexed += 1;
    }
    const next = ids.length === batch ? ids[ids.length - 1] : "";
    result.cursors[kind] = next;
    if (!dryRun) await writeCursor(db, kind, next, now);
  }

  /* 2. Of the keys those items touched, keep the ones with enough rows to matter. */
  const pendingByKey = new Map<string, Pending[]>();
  for (const entry of pending) for (const key of entry.keys) pendingByKey.set(key, [...(pendingByKey.get(key) ?? []), entry]);
  const touched = [...pendingByKey.keys()].sort();
  result.keysTouched = touched.length;
  const potential: Array<{ key: string; rows: number }> = [];
  for (const group of chunked(touched, IN_LIST_CHUNK)) {
    const counts = await db
      .prepare(
        `SELECT signal_key AS key, COUNT(*) AS rows FROM hubpedia_hub_topic_signals
         WHERE signal_key IN (${group.map(() => "?").join(",")}) GROUP BY signal_key`,
      )
      .bind(...group)
      .all<{ key: string; rows: number }>();
    const stored = new Map(counts.results.map((row) => [row.key, Number(row.rows)]));
    for (const key of group) {
      /* In a dry run the pending rows are not stored yet; add them in. */
      const rows = dryRun ? (stored.get(key) ?? 0) + (pendingByKey.get(key)?.length ?? 0) : (stored.get(key) ?? 0);
      if (rows >= HUB_TOPIC_MIN_AUTHORS) potential.push({ key, rows });
    }
  }
  potential.sort((a, b) => b.rows - a.rows || (a.key < b.key ? -1 : 1));

  /* 3. Evaluate the most promising keys against live eligibility. */
  type Group = { key: string; members: Member[]; authors: Set<string>; families: Set<string> };
  const groups: Group[] = [];
  for (const { key } of potential.slice(0, KEYS_EVALUATED_PER_RUN)) {
    result.keysEvaluated += 1;
    const stored = (
      await db
        .prepare(
          `SELECT kind, item_id AS itemId, author_profile_id AS author FROM hubpedia_hub_topic_signals
           WHERE signal_key = ? ORDER BY kind, item_id LIMIT ${MEMBER_ROWS_PER_KEY}`,
        )
        .bind(key)
        .all<{ kind: HubEvidenceKind; itemId: string; author: string }>()
    ).results;
    const merged = new Map<string, { kind: HubEvidenceKind; itemId: string; author: string }>();
    for (const row of stored) merged.set(`${row.kind}\u0000${row.itemId}`, row);
    for (const row of pendingByKey.get(key) ?? []) merged.set(`${row.kind}\u0000${row.itemId}`, { kind: row.kind, itemId: row.itemId, author: row.author });
    const candidates = interleaveByFamily([...merged.values()].sort((a, b) => (a.kind === b.kind ? (a.itemId < b.itemId ? -1 : 1) : a.kind < b.kind ? -1 : 1)));

    /* Re-check every member now: an opt-out, deletion or edit since indexing must not count. */
    const members: Member[] = [];
    for (const row of candidates) {
      if (members.length >= HUB_TOPIC_MEMBER_LIMIT) break;
      const item = await evaluateHubItem(db, row.kind, row.itemId);
      if (!item.eligible) {
        if (!dryRun) await clearItemSignals(db, row.kind, row.itemId);
        continue;
      }
      members.push({ kind: row.kind, itemId: row.itemId, author: item.authorProfileId, text: item.text });
    }
    const authors = new Set(members.map((member) => member.author));
    const families = new Set(members.map((member) => kindFamily(member.kind)));
    if (authors.size < HUB_TOPIC_MIN_AUTHORS || families.size < HUB_TOPIC_MIN_KIND_FAMILIES) {
      result.skipped.push({ signalKey: key, reason: "below_threshold" });
      continue;
    }
    groups.push({ key, members, authors, families });
  }

  /* 4. Pick, de-duplicate, and record. Strongest cluster first. */
  groups.sort((a, b) => b.authors.size - a.authors.size || b.families.size - a.families.size || b.members.length - a.members.length || (a.key < b.key ? -1 : 1));
  const selected: Group[] = [];
  for (const group of groups) {
    if (result.candidates.length >= maxCandidates) break;
    const skip = (reason: HubTopicSkipReason) => result.skipped.push({ signalKey: group.key, reason });
    const label = labelFor(group.key, group.members);
    if (Array.from(label).length < 2) { skip("label_too_short"); continue; }
    if (await db.prepare("SELECT 1 AS found FROM hubpedia_hub_topic_candidates WHERE signal_key = ?").bind(group.key).first()) {
      skip("already_a_candidate");
      continue;
    }
    if (await isCovered(label)) { skip("covered_by_existing_article"); continue; }

    const ids = new Set(group.members.map((member) => `${member.kind}\u0000${member.itemId}`));
    const overlapsSelected = selected.some((other) => {
      const shared = other.members.filter((member) => ids.has(`${member.kind}\u0000${member.itemId}`)).length;
      return shared / Math.min(other.members.length, group.members.length) >= OVERLAP_THRESHOLD;
    });
    if (overlapsSelected) { skip("overlaps_selected_topic"); continue; }
    const hits = new Map<string, number>();
    for (const member of group.members) {
      const rows = await db
        .prepare("SELECT candidate_id AS id FROM hubpedia_hub_topic_candidate_items WHERE kind = ? AND item_id = ?")
        .bind(member.kind, member.itemId)
        .all<{ id: string }>();
      for (const row of rows.results) hits.set(row.id, (hits.get(row.id) ?? 0) + 1);
    }
    if ([...hits.values()].some((count) => count / group.members.length >= OVERLAP_THRESHOLD)) {
      skip("overlaps_existing_candidate");
      continue;
    }

    const { anchor, reason } = await loadAnchor(db, group.members);
    if (!anchor) { skip(reason); continue; }

    const entry: HubTopicPlanEntry = {
      signalKey: group.key,
      label,
      authors: group.authors.size,
      kindFamilies: [...group.families].sort(),
      items: group.members.map((member) => ({ kind: member.kind, itemId: member.itemId })),
      anchor: { sourceType: anchor.sourceType, sourceId: anchor.sourceId },
    };
    if (dryRun) {
      selected.push(group);
      result.candidates.push({ ...entry, candidateId: null });
      continue;
    }
    const candidateId = crypto.randomUUID();
    const stamp = now.toISOString();
    const anchorItem = group.members.find((member) => member.kind === anchor.member.kind && member.itemId === anchor.member.itemId)!;
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO hubpedia_article_candidates
               (id, source_type, source_id, proposed_title, source_excerpt, proposer_profile_id, signal_count, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
          )
          .bind(candidateId, anchor.sourceType, anchor.sourceId, label, limitQuote(anchorItem.text ?? label) || label, anchorItem.author, group.authors.size, stamp, stamp),
        db
          .prepare(
            `INSERT INTO hubpedia_hub_topic_candidates
               (candidate_id, signal_key, topic_label, author_count, kind_count, item_count, detected_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(candidateId, group.key, label, group.authors.size, group.families.size, group.members.length, stamp, stamp),
        ...group.members.map((member) =>
          db
            .prepare("INSERT INTO hubpedia_hub_topic_candidate_items(candidate_id, kind, item_id) VALUES (?, ?, ?)")
            .bind(candidateId, member.kind, member.itemId),
        ),
      ]);
    } catch {
      skip("write_conflict");
      continue;
    }
    selected.push(group);
    result.candidates.push({ ...entry, candidateId });
  }
  return result;
}

/* --------------------------------------------------------- scheduled pass */

/**
 * The hub-maintenance-jobs entry point: a small, bounded step with defaults,
 * continuing from the persisted cursors.
 */
export async function runScheduledHubTopicScan(
  db: D1Database,
  options: Pick<HubTopicScanOptions, "isCovered" | "batchPerKind" | "maxCandidates"> = {},
  now: Date = new Date(),
) {
  return runHubTopicScan(db, { ...options, dryRun: false }, now);
}
