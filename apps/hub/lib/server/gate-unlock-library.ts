import type { D1Database } from "@cloudflare/workers-types";

import { gatedTargetIds } from "@/lib/server/gated-exits";

/*
 * 入手した作品 (2026-10-26)。ゲートを通って開いた作品の、本人だけが読める一覧。
 *
 * - 書くのは「サーバー側の完全なゲート検査が許可し、閲覧者が持ち主でも書き手でもない」ときだけ。
 * - 読む・消す・書き出すのは本人の profile_id だけ。作者や管理者向けの読み口、件数、集計は作らない。
 *   作者はゲートを通った人も人数も知ってはならない（AGENTS.md）。ログに profile ID を出さない。
 * - ウォレットアドレス・残高・ゲートIDは持たない。
 * - 一覧は便利のためで、認可ではない。一覧から開いても通常のゲート検査が走る。
 */

export const GATE_UNLOCK_TARGET_TYPES = ["post", "article", "video", "thread"] as const;
export type GateUnlockTargetType = (typeof GATE_UNLOCK_TARGET_TYPES)[number];

const TYPE_SET: ReadonlySet<string> = new Set(GATE_UNLOCK_TARGET_TYPES);
export const GATE_UNLOCK_PAGE_SIZE = 30;
const ID_CHUNK = 80;

export type GateUnlockKey = { targetType: GateUnlockTargetType; targetId: string };

export function isGateUnlockTargetType(value: string): value is GateUnlockTargetType {
  return TYPE_SET.has(value);
}

/** Upsert. Throws on failure; callers that must stay silent use `scheduleGateUnlocks`. */
export async function recordGateUnlocks(
  database: D1Database,
  profileId: string,
  keys: readonly GateUnlockKey[],
  now: string = new Date().toISOString(),
): Promise<void> {
  const unique = new Map<string, GateUnlockKey>();
  for (const key of keys) {
    if (!TYPE_SET.has(key.targetType) || !key.targetId || key.targetId.length > 200) continue;
    unique.set(`${key.targetType}\n${key.targetId}`, key);
  }
  if (!profileId || unique.size === 0) return;
  const statements = [...unique.values()].map((key) =>
    database
      .prepare(
        `INSERT INTO hub_gate_unlocks (profile_id, target_type, target_id, first_opened_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (profile_id, target_type, target_id) DO UPDATE SET last_opened_at = excluded.last_opened_at`,
      )
      .bind(profileId, key.targetType, key.targetId, now),
  );
  await database.batch(statements);
}

const pending = new Set<Promise<void>>();

/**
 * Fire-and-forget: never throws, never delays the caller, logs nothing that identifies the viewer.
 * Uses the platform's waitUntil when there is one so the write outlives the response.
 */
export function scheduleGateUnlocks(database: D1Database, profileId: string, keys: readonly GateUnlockKey[]): void {
  if (keys.length === 0) return;
  let task: Promise<void>;
  try {
    task = recordGateUnlocks(database, profileId, keys).catch(() => undefined);
  } catch {
    return;
  }
  pending.add(task);
  void task.finally(() => pending.delete(task));
  void import("@opennextjs/cloudflare")
    .then((mod) => mod.getCloudflareContext().ctx.waitUntil(task))
    .catch(() => undefined);
}

/** Test hook: resolves when every scheduled write has settled. */
export async function flushGateUnlockWrites(): Promise<void> {
  await Promise.all([...pending]);
}

/* ---------------------------------------------------------------- reading */

export type GateUnlockItem = {
  targetType: GateUnlockTargetType;
  targetId: string;
  /** Titles only. A post has no title: the UI shows "投稿" and `postedAt`. */
  title: string | null;
  postedAt: string | null;
  lastOpenedAt: string;
  /** gated: still behind a gate. open: the gate was removed. gone: the work no longer exists. */
  state: "gated" | "open" | "gone";
  href: string | null;
};

export type GateUnlockPage = { items: GateUnlockItem[]; nextCursor: string | null };

type Row = { target_type: string; target_id: string; last_opened_at: string };

export function encodeUnlockCursor(row: { lastOpenedAt: string; targetType: string; targetId: string }): string {
  return encodeURIComponent(JSON.stringify([row.lastOpenedAt, row.targetType, row.targetId]));
}

export function decodeUnlockCursor(cursor: string | null | undefined): [string, string, string] | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(cursor));
    if (Array.isArray(parsed) && parsed.length === 3 && parsed.every((part) => typeof part === "string")) {
      return parsed as [string, string, string];
    }
  } catch {
    /* fall through */
  }
  return null;
}

function hrefFor(type: GateUnlockTargetType, id: string): string {
  const base = { post: "/posts", article: "/articles", video: "/videos", thread: "/threads" }[type];
  return `${base}/${encodeURIComponent(id)}`;
}

type Label = { title: string | null; postedAt: string | null };

async function loadLabels(database: D1Database, type: GateUnlockTargetType, ids: readonly string[]): Promise<Map<string, Label>> {
  const labels = new Map<string, Label>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const marks = chunk.map(() => "?").join(",");
    const query = {
      article: `SELECT id, title AS title, NULL AS posted_at FROM hub_user_articles WHERE moderated_at IS NULL AND id IN (${marks})`,
      thread: `SELECT id, title AS title, NULL AS posted_at FROM threads WHERE id IN (${marks})`,
      video: `SELECT id, title AS title, NULL AS posted_at FROM external_videos WHERE status = 'active' AND id IN (${marks})`,
      post: `SELECT id, NULL AS title, created_at AS posted_at FROM social_posts WHERE id IN (${marks})`,
    }[type];
    const result = await database.prepare(query).bind(...chunk).all<{ id: string; title: string | null; posted_at: string | null }>();
    for (const row of result.results ?? []) labels.set(row.id, { title: row.title, postedAt: row.posted_at });
  }
  return labels;
}

/** The viewer's own list, newest first, paged by key (no OFFSET). */
export async function listOwnGateUnlocks(
  database: D1Database,
  profileId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<GateUnlockPage> {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? GATE_UNLOCK_PAGE_SIZE) || GATE_UNLOCK_PAGE_SIZE, 100));
  const cursor = decodeUnlockCursor(options.cursor);
  const result = cursor
    ? await database
        .prepare(
          `SELECT target_type, target_id, last_opened_at FROM hub_gate_unlocks
            WHERE profile_id = ?1
              AND (last_opened_at < ?2 OR (last_opened_at = ?2 AND (target_type > ?3 OR (target_type = ?3 AND target_id > ?4))))
            ORDER BY last_opened_at DESC, target_type ASC, target_id ASC LIMIT ?5`,
        )
        .bind(profileId, cursor[0], cursor[1], cursor[2], limit + 1)
        .all<Row>()
    : await database
        .prepare(
          `SELECT target_type, target_id, last_opened_at FROM hub_gate_unlocks
            WHERE profile_id = ?1
            ORDER BY last_opened_at DESC, target_type ASC, target_id ASC LIMIT ?2`,
        )
        .bind(profileId, limit + 1)
        .all<Row>();
  const all = (result.results ?? []).filter((row) => TYPE_SET.has(row.target_type));
  const hasMore = all.length > limit;
  const page = all.slice(0, limit);

  const labels = new Map<GateUnlockTargetType, Map<string, Label>>();
  const gated = new Map<GateUnlockTargetType, Set<string>>();
  for (const type of GATE_UNLOCK_TARGET_TYPES) {
    const ids = page.filter((row) => row.target_type === type).map((row) => row.target_id);
    if (ids.length === 0) continue;
    labels.set(type, await loadLabels(database, type, ids));
    gated.set(type, await gatedTargetIds(database, type, ids));
  }

  const items = page.map((row): GateUnlockItem => {
    const type = row.target_type as GateUnlockTargetType;
    const label = labels.get(type)?.get(row.target_id);
    if (!label) {
      return { targetType: type, targetId: row.target_id, title: null, postedAt: null, lastOpenedAt: row.last_opened_at, state: "gone", href: null };
    }
    return {
      targetType: type,
      targetId: row.target_id,
      title: label.title,
      postedAt: label.postedAt,
      lastOpenedAt: row.last_opened_at,
      state: gated.get(type)?.has(row.target_id) ? "gated" : "open",
      href: hrefFor(type, row.target_id),
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeUnlockCursor({ lastOpenedAt: last.last_opened_at, targetType: last.target_type, targetId: last.target_id }) : null,
  };
}

/* ---------------------------------------------------------------- deleting / export */

export async function deleteOwnGateUnlock(database: D1Database, profileId: string, key: GateUnlockKey): Promise<void> {
  await database
    .prepare("DELETE FROM hub_gate_unlocks WHERE profile_id = ? AND target_type = ? AND target_id = ?")
    .bind(profileId, key.targetType, key.targetId)
    .run();
}

export async function clearOwnGateUnlocks(database: D1Database, profileId: string): Promise<void> {
  await database.prepare("DELETE FROM hub_gate_unlocks WHERE profile_id = ?").bind(profileId).run();
}

export async function readOwnGateUnlocksExport(database: D1Database, profileId: string) {
  const result = await database
    .prepare(
      `SELECT target_type, target_id, first_opened_at, last_opened_at FROM hub_gate_unlocks
        WHERE profile_id = ? ORDER BY first_opened_at, target_type, target_id`,
    )
    .bind(profileId)
    .all<{ target_type: string; target_id: string; first_opened_at: string; last_opened_at: string }>();
  return result.results ?? [];
}
