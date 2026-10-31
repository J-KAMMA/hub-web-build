import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import {
  getHubStorageAccountClient,
  type HubStorageAccountClient,
} from "@/lib/server/hub-storage-account-client";

/*
 * Reserve / commit / release for Hub images (docs/hub-storage-plans/PLAN.md 1.4, 1.7, 4.1, 4.4, 4.5).
 *
 * - A profile linked to the common Account (account_profile_links) is limited by Account: the
 *   reservation is asked of Account, which owns the total across Hub, Music and files.
 * - A profile without a link is limited by Hub alone: a local counter capped at 100MB.
 * - Both keep an incremental local counter (hub_storage_usage). No request SUMs over file rows.
 * - Uploads stop at the limit. Nothing is ever deleted because of the limit.
 * - Releasing on delete / expiry is done by the triggers in migration 0263; this module covers
 *   what has no row to hang a trigger on (community images) and the Account re-send queue.
 * - If Account cannot be reached for a linked profile, the upload fails closed.
 * - The Hub-audience subject is read from account_profile_links when needed and is never copied
 *   into the storage tables.
 */

export const HUB_STORAGE_FREE_BYTES = 100 * 1024 * 1024;
export const HUB_STORAGE_NEAR_LIMIT_RATIO = 0.8;
export const HUB_STORAGE_RESERVATION_TTL_MS = 30 * 60 * 1000;
const NOTICE_REARM_MS = 30 * 24 * 60 * 60 * 1000;
const OUTBOX_BACKOFF_CAP_SECONDS = 3600;

/** `content_file`: gated file attachments held by the file component (content-file-storage.ts, migration 0264). */
export type HubStorageKind = "social_post_image" | "dm_image" | "community_image" | "content_file";

export type HubStorageErrorCode = "over_limit" | "unavailable";

export class HubStorageError extends Error {
  constructor(readonly code: HubStorageErrorCode) {
    super(code === "over_limit"
      ? "保存容量の上限に達しました。ファイルを減らしてから、もう一度アップロードしてください。"
      : "今は保存できません。少し待ってからやり直してください。");
    this.name = "HubStorageError";
  }
}

export type HubStorageReservation = {
  mode: "local" | "account";
  profileId: string;
  kind: HubStorageKind;
  objectId: string;
  bytes: number;
  reservationId: string | null;
};

/** Self-hosted Hubs set their own cap (PLAN 1.1); the default is 100MB, never unlimited. */
export function localStorageLimitBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = env.HUB_STORAGE_LOCAL_LIMIT_BYTES?.trim();
  if (raw && /^[0-9]{1,15}$/u.test(raw) && Number(raw) > 0) return Number(raw);
  return HUB_STORAGE_FREE_BYTES;
}

const nowIso = () => new Date().toISOString();
const objectKey = (kind: HubStorageKind, objectId: string) => `${kind}:${objectId}`;

async function linkedSubject(database: D1Database, profileId: string): Promise<string | null> {
  const row = await database.prepare("SELECT pairwise_subject FROM account_profile_links WHERE profile_id = ?")
    .bind(profileId).first<{ pairwise_subject: string }>();
  return row?.pairwise_subject ?? null;
}

const ensureUsage = (database: D1Database, profileId: string, now: string) =>
  database.prepare(`INSERT OR IGNORE INTO hub_storage_usage (profile_id, committed_bytes, reserved_bytes, object_count, updated_at)
    VALUES (?1, 0, 0, 0, ?2)`).bind(profileId, now);

const outboxInsert = (
  database: D1Database,
  input: { kind: "commit" | "release" | "adopt"; profileId: string; objectKind: HubStorageKind; objectId: string; reservationId: string | null; bytes: number; now: string },
) => database.prepare(`INSERT INTO hub_storage_outbox
    (id, kind, profile_id, object_kind, object_id, reservation_id, bytes, next_attempt_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`)
  .bind(crypto.randomUUID(), input.kind, input.profileId, input.objectKind, input.objectId, input.reservationId, input.bytes, input.now);

/* ---------------------------------------------------------------- notifications (PLAN 4.5) */

const NOTICE_TEXT = {
  near_limit: "保存容量が上限の80%に達しました。",
  at_limit: "保存容量が上限に達しました。新しいアップロードはできません。ファイルを減らすと、またアップロードできます。",
} as const;

async function fireNotice(database: D1Database, profileId: string, kind: keyof typeof NOTICE_TEXT): Promise<void> {
  try {
    const now = new Date();
    const claimed = await database.prepare(`INSERT INTO hub_storage_notices (profile_id, kind, valid_until)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(profile_id, kind) DO UPDATE SET valid_until = excluded.valid_until
      WHERE hub_storage_notices.valid_until < ?4`)
      .bind(profileId, kind, new Date(now.getTime() + NOTICE_REARM_MS).toISOString(), now.toISOString()).run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) return;
    await database.prepare(`INSERT INTO notifications
      (id, receiver_profile_id, actor_profile_id, notification_type, notification_context, target_type, target_id, text, is_read, created_at)
      VALUES (?1, ?2, NULL, 'system', NULL, 'system', ?3, ?4, 0, ?5)`)
      .bind(crypto.randomUUID(), profileId, `storage:${kind}`, NOTICE_TEXT[kind], now.toISOString()).run();
  } catch {
    // A missed notice must never fail an upload.
  }
}

/** 自動更新の 3 日前の知らせ（AUTOPAY.md §2.6）。Hub の通知だけ。メールは送らない。次の更新ごとに 1 回。 */
export const AUTOPAY_NOTICE_LEAD_MS = 3 * 24 * 60 * 60 * 1000;

export async function fireHubAutopayDueNotice(database: D1Database, profileId: string, nextRenewalAt: string, now: Date = new Date()): Promise<void> {
  try {
    const due = Date.parse(nextRenewalAt);
    if (!Number.isFinite(due) || due <= now.getTime() || due - now.getTime() > AUTOPAY_NOTICE_LEAD_MS) return;
    const claimed = await database.prepare(`INSERT INTO hub_storage_notices (profile_id, kind, valid_until)
      VALUES (?1, 'autopay_due', ?2)
      ON CONFLICT(profile_id, kind) DO UPDATE SET valid_until = excluded.valid_until
      WHERE hub_storage_notices.valid_until < ?3`)
      .bind(profileId, new Date(due + 24 * 60 * 60 * 1000).toISOString(), now.toISOString()).run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) return;
    const day = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(due);
    await database.prepare(`INSERT INTO notifications
      (id, receiver_profile_id, actor_profile_id, notification_type, notification_context, target_type, target_id, text, is_read, created_at)
      VALUES (?1, ?2, NULL, 'system', NULL, 'system', ?3, ?4, 0, ?5)`)
      .bind(crypto.randomUUID(), profileId, "storage:autopay_due", `3日後（${day}）に保存容量プランを自動で更新します。止めるときは、設定の保存容量から［自動更新を止める］を選んでください。`, now.toISOString()).run();
  } catch {
    // 知らせの失敗で容量の表示を止めない。
  }
}

/**
 * 方式の移り変わりを見て「自動更新が止まりました」を 1 回だけ出す（AUTOPAY.md §2.5）。
 * 自動だった印（autopay_active）を覚え、手動に変わったときに印を消せた 1 回だけ知らせる。
 * 利用者がこのセッションで止めたとき（userStopped）は印を消すだけで知らせない。何度読んでも 1 回。
 */
export async function reconcileHubAutopayMode(
  database: D1Database,
  profileId: string,
  mode: "manual" | "auto",
  options: { userStopped?: boolean; now?: Date } = {},
): Promise<void> {
  try {
    const now = options.now ?? new Date();
    if (mode === "auto") {
      await database.prepare(`INSERT INTO hub_storage_notices (profile_id, kind, valid_until) VALUES (?1, 'autopay_active', ?2)
        ON CONFLICT(profile_id, kind) DO UPDATE SET valid_until = excluded.valid_until`)
        .bind(profileId, now.toISOString()).run();
      return;
    }
    const cleared = await database.prepare("DELETE FROM hub_storage_notices WHERE profile_id = ?1 AND kind = 'autopay_active'").bind(profileId).run();
    if (Number(cleared.meta?.changes ?? 0) !== 1 || options.userStopped) return;
    await database.prepare(`INSERT INTO notifications
      (id, receiver_profile_id, actor_profile_id, notification_type, notification_context, target_type, target_id, text, is_read, created_at)
      VALUES (?1, ?2, NULL, 'system', NULL, 'system', ?3, ?4, 0, ?5)`)
      .bind(crypto.randomUUID(), profileId, "storage:autopay_stopped", "自動更新が止まりました。今のプランは期限（猶予を含む）まで使えます。手動で更新するか、設定の保存容量から自動更新をもう一度始められます。", now.toISOString()).run();
  } catch {
    // 知らせの失敗で容量の表示を止めない。
  }
}

async function noticeForUsage(database: D1Database, profileId: string, usedBytes: number, limitBytes: number): Promise<void> {
  if (usedBytes >= limitBytes) await fireNotice(database, profileId, "at_limit");
  else if (usedBytes >= limitBytes * HUB_STORAGE_NEAR_LIMIT_RATIO) await fireNotice(database, profileId, "near_limit");
}

/* ---------------------------------------------------------------- reserve */

export async function reserveHubStorage(
  database: D1Database,
  input: { profileId: string; kind: HubStorageKind; objectId: string; bytes: number },
  account: HubStorageAccountClient = getHubStorageAccountClient(),
): Promise<HubStorageReservation> {
  const { profileId, kind, objectId, bytes } = input;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new HubStorageError("unavailable");

  let subject: string | null;
  try {
    subject = await linkedSubject(database, profileId);
  } catch {
    throw new HubStorageError("unavailable");
  }

  if (subject) {
    const reply = await account.reserve({ subject, bytes, idempotencyKey: objectKey(kind, objectId) });
    if (!reply.ok) {
      if (reply.reason === "over_limit") {
        await fireNotice(database, profileId, "at_limit");
        throw new HubStorageError("over_limit");
      }
      throw new HubStorageError("unavailable");
    }
    if (reply.usedBytes !== null && reply.limitBytes !== null) await noticeForUsage(database, profileId, reply.usedBytes, reply.limitBytes);
    return { mode: "account", profileId, kind, objectId, bytes, reservationId: reply.reservationId };
  }

  const limit = localStorageLimitBytes();
  const now = nowIso();
  let changes = 0;
  try {
    const results = await database.batch([
      ensureUsage(database, profileId, now),
      database.prepare(`UPDATE hub_storage_usage SET reserved_bytes = reserved_bytes + ?1, updated_at = ?2
        WHERE profile_id = ?3 AND committed_bytes + reserved_bytes + ?1 <= ?4`).bind(bytes, now, profileId, limit),
      database.prepare(`INSERT INTO hub_storage_objects (kind, object_id, profile_id, bytes, state, reservation_id, created_at)
        SELECT ?1, ?2, ?3, ?4, 'reserved', NULL, ?5 WHERE (SELECT changes()) = 1`).bind(kind, objectId, profileId, bytes, now),
    ]);
    changes = Number(results[1]?.meta?.changes ?? 0);
  } catch {
    throw new HubStorageError("unavailable");
  }
  if (changes !== 1) {
    await fireNotice(database, profileId, "at_limit");
    throw new HubStorageError("over_limit");
  }
  try {
    const usage = await database.prepare("SELECT committed_bytes + reserved_bytes AS used FROM hub_storage_usage WHERE profile_id = ?")
      .bind(profileId).first<{ used: number }>();
    await noticeForUsage(database, profileId, Number(usage?.used ?? 0), limit);
  } catch { /* notice only */ }
  return { mode: "local", profileId, kind, objectId, bytes, reservationId: null };
}

/* ---------------------------------------------------------------- commit */

/**
 * Statements that make the reservation permanent. Put them in the same batch as the row that
 * records the file. `actualBytes` is what was really stored; more than reserved is refused.
 */
export function commitHubStorageStatements(database: D1Database, reservation: HubStorageReservation, actualBytes: number): D1PreparedStatement[] {
  if (!Number.isSafeInteger(actualBytes) || actualBytes <= 0 || actualBytes > reservation.bytes) throw new HubStorageError("unavailable");
  const now = nowIso();
  const { profileId, kind, objectId } = reservation;
  if (reservation.mode === "local") {
    return [
      database.prepare(`UPDATE hub_storage_usage
        SET reserved_bytes = max(0, reserved_bytes - ?1), committed_bytes = committed_bytes + ?2, object_count = object_count + 1, updated_at = ?3
        WHERE profile_id = ?4 AND EXISTS (SELECT 1 FROM hub_storage_objects WHERE kind = ?5 AND object_id = ?6 AND state = 'reserved')`)
        .bind(reservation.bytes, actualBytes, now, profileId, kind, objectId),
      database.prepare("UPDATE hub_storage_objects SET state = 'committed', bytes = ?1 WHERE kind = ?2 AND object_id = ?3 AND state = 'reserved'")
        .bind(actualBytes, kind, objectId),
    ];
  }
  return [
    ensureUsage(database, profileId, now),
    database.prepare("UPDATE hub_storage_usage SET committed_bytes = committed_bytes + ?1, object_count = object_count + 1, updated_at = ?2 WHERE profile_id = ?3")
      .bind(actualBytes, now, profileId),
    database.prepare(`INSERT OR REPLACE INTO hub_storage_objects (kind, object_id, profile_id, bytes, state, reservation_id, created_at)
      VALUES (?1, ?2, ?3, ?4, 'committed', ?5, ?6)`).bind(kind, objectId, profileId, actualBytes, reservation.reservationId, now),
    outboxInsert(database, { kind: "commit", profileId, objectKind: kind, objectId, reservationId: reservation.reservationId, bytes: actualBytes, now }),
  ];
}

/** After the batch: try the Account commit once now. A failure leaves it in the outbox for the next sweep. */
export async function finishHubStorageCommit(
  database: D1Database,
  reservation: HubStorageReservation,
  account: HubStorageAccountClient = getHubStorageAccountClient(),
): Promise<void> {
  if (reservation.mode !== "account") return;
  try {
    const row = await database.prepare(`SELECT id, kind, profile_id, object_kind, object_id, reservation_id, bytes, attempts
      FROM hub_storage_outbox WHERE object_kind = ?1 AND object_id = ?2 AND kind = 'commit' AND delivered_at IS NULL LIMIT 1`)
      .bind(reservation.kind, reservation.objectId).first<OutboxRow>();
    if (row) await deliverOutboxRow(database, account, row, new Date());
  } catch { /* the outbox row is already durable */ }
}

/** Give back a reservation whose upload did not complete. Never throws. */
export async function abandonHubStorage(
  database: D1Database,
  reservation: HubStorageReservation,
  account: HubStorageAccountClient = getHubStorageAccountClient(),
): Promise<void> {
  try {
    if (reservation.mode === "account") {
      const subject = await linkedSubject(database, reservation.profileId);
      if (subject) {
        // If this fails Account expires the reservation on its own after 30 minutes.
        if (reservation.reservationId) await account.release({ subject, reservationId: reservation.reservationId });
      }
      return;
    }
    await database.batch(expireReservationStatements(database, reservation.profileId, reservation.kind, reservation.objectId, nowIso()));
  } catch { /* the stale-reservation sweep recovers local reservations */ }
}

const expireReservationStatements = (database: D1Database, profileId: string, kind: HubStorageKind, objectId: string, now: string) => [
  database.prepare(`UPDATE hub_storage_usage
    SET reserved_bytes = max(0, reserved_bytes - (SELECT bytes FROM hub_storage_objects WHERE kind = ?2 AND object_id = ?3 AND state = 'reserved')), updated_at = ?4
    WHERE profile_id = ?1 AND EXISTS (SELECT 1 FROM hub_storage_objects WHERE kind = ?2 AND object_id = ?3 AND state = 'reserved')`)
    .bind(profileId, kind, objectId, now),
  database.prepare("UPDATE hub_storage_objects SET state = 'released' WHERE kind = ?1 AND object_id = ?2 AND state = 'reserved'")
    .bind(kind, objectId),
];

/* ---------------------------------------------------------------- imports (PLAN 4.4) */

/**
 * Counts an imported file without any limit check: an account move must never be blocked by the
 * limit. The profile is simply over the limit afterwards, and only new uploads stop.
 * Add these to the batch that writes the image row.
 */
export function importedStorageStatements(
  database: D1Database,
  input: { profileId: string; kind: HubStorageKind; objectId: string; bytes: number },
): D1PreparedStatement[] {
  const now = nowIso();
  const { profileId, kind, objectId, bytes } = input;
  return [
    ensureUsage(database, profileId, now),
    database.prepare("UPDATE hub_storage_usage SET committed_bytes = committed_bytes + ?1, object_count = object_count + 1, updated_at = ?2 WHERE profile_id = ?3")
      .bind(bytes, now, profileId),
    database.prepare(`INSERT OR IGNORE INTO hub_storage_objects (kind, object_id, profile_id, bytes, state, reservation_id, created_at)
      VALUES (?1, ?2, ?3, ?4, 'committed', NULL, ?5)`).bind(kind, objectId, profileId, bytes, now),
    outboxInsert(database, { kind: "adopt", profileId, objectKind: kind, objectId, reservationId: null, bytes, now }),
  ];
}

/* ---------------------------------------------------------------- release by hand */

/**
 * Release for objects with no table row for a trigger to watch (community images). Same effect
 * as the triggers; a second call is a no-op because only a committed object is released.
 */
export async function releaseHubStorageObject(database: D1Database, kind: HubStorageKind, objectId: string): Promise<void> {
  const now = nowIso();
  await database.batch([
    database.prepare(`INSERT INTO hub_storage_outbox (id, kind, profile_id, object_kind, object_id, reservation_id, bytes, next_attempt_at, created_at)
      SELECT ?3, 'release', o.profile_id, o.kind, o.object_id, o.reservation_id, o.bytes, ?4, ?4
      FROM hub_storage_objects o WHERE o.kind = ?1 AND o.object_id = ?2 AND o.state = 'committed'`)
      .bind(kind, objectId, crypto.randomUUID(), now),
    database.prepare(`UPDATE hub_storage_usage
      SET committed_bytes = max(0, committed_bytes - (SELECT o.bytes FROM hub_storage_objects o WHERE o.kind = ?1 AND o.object_id = ?2 AND o.state = 'committed')),
          object_count = max(0, object_count - 1), updated_at = ?3
      WHERE profile_id = (SELECT o.profile_id FROM hub_storage_objects o WHERE o.kind = ?1 AND o.object_id = ?2 AND o.state = 'committed')`)
      .bind(kind, objectId, now),
    database.prepare("UPDATE hub_storage_objects SET state = 'released' WHERE kind = ?1 AND object_id = ?2 AND state = 'committed'")
      .bind(kind, objectId),
  ]);
}

/* ---------------------------------------------------------------- outbox + stale reservations */

type OutboxRow = {
  id: string;
  kind: "commit" | "release" | "adopt";
  profile_id: string;
  object_kind: HubStorageKind;
  object_id: string;
  reservation_id: string | null;
  bytes: number;
  attempts: number;
};

async function deliverOutboxRow(database: D1Database, account: HubStorageAccountClient, row: OutboxRow, now: Date): Promise<"delivered" | "dropped" | "failed"> {
  const subject = await linkedSubject(database, row.profile_id);
  if (!subject) {
    // Not (or no longer) linked: Hub's own counter is the only record, nothing to tell Account.
    await database.prepare("DELETE FROM hub_storage_outbox WHERE id = ?").bind(row.id).run();
    return "dropped";
  }
  const backoff = async (): Promise<"failed"> => {
    const delay = Math.min(OUTBOX_BACKOFF_CAP_SECONDS, 30 * 2 ** Math.min(row.attempts, 12));
    await database.prepare("UPDATE hub_storage_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ?")
      .bind(new Date(now.getTime() + delay * 1000).toISOString(), row.id).run();
    return "failed";
  };
  const done = async (): Promise<"delivered"> => {
    await database.prepare("DELETE FROM hub_storage_outbox WHERE id = ?").bind(row.id).run();
    return "delivered";
  };
  if (row.kind === "adopt") {
    const reply = await account.adopt({ subject, bytes: row.bytes, idempotencyKey: objectKey(row.object_kind, row.object_id) });
    if (!reply.ok || !reply.reservationId) return backoff();
    // Remember Account's id for the adopted bytes so a later delete can release them.
    await database.prepare("UPDATE hub_storage_objects SET reservation_id = ?1 WHERE kind = ?2 AND object_id = ?3 AND reservation_id IS NULL")
      .bind(reply.reservationId, row.object_kind, row.object_id).run();
    return done();
  }
  if (row.kind === "commit") {
    if (!row.reservation_id) return backoff();
    const reply = await account.commit({ subject, reservationId: row.reservation_id, bytes: row.bytes });
    if (reply.ok) return done();
    if (reply.reason === "expired") {
      // The reservation lapsed before the commit: the stored object must go (PLAN 1.4). Marking it
      // deleted lets the trigger give the bytes back and the next prune remove the R2 object.
      const table = row.object_kind === "social_post_image" ? "social_post_images" : row.object_kind === "dm_image" ? "direct_message_images" : null;
      if (table) await database.prepare(`UPDATE ${table} SET status = 'deleted' WHERE id = ? AND status <> 'deleted'`).bind(row.object_id).run();
      else await releaseHubStorageObject(database, row.object_kind, row.object_id);
      return done();
    }
    return backoff();
  }
  // release: the id may have been learned from an adopt that is still queued.
  let reservationId = row.reservation_id;
  if (!reservationId) {
    const object = await database.prepare("SELECT reservation_id FROM hub_storage_objects WHERE kind = ?1 AND object_id = ?2")
      .bind(row.object_kind, row.object_id).first<{ reservation_id: string | null }>();
    reservationId = object?.reservation_id ?? null;
  }
  if (!reservationId) {
    const pending = await database.prepare("SELECT 1 AS hit FROM hub_storage_outbox WHERE object_kind = ?1 AND object_id = ?2 AND kind IN ('adopt', 'commit') LIMIT 1")
      .bind(row.object_kind, row.object_id).first();
    if (pending) return backoff();
    // Never counted by Account (it was local-only): nothing to release there.
    await database.prepare("DELETE FROM hub_storage_outbox WHERE id = ?").bind(row.id).run();
    return "dropped";
  }
  const reply = await account.release({ subject, reservationId });
  return reply.ok ? done() : backoff();
}
/** Maintenance: expire stale local reservations, then re-send what Account has not acknowledged. */
export async function drainHubStorageOutbox(
  database: D1Database,
  account: HubStorageAccountClient = getHubStorageAccountClient(),
  options: { now?: Date; limit?: number } = {},
): Promise<{ swept: number; delivered: number; dropped: number; failed: number }> {
  const now = options.now ?? new Date();
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 25)));
  const cutoff = new Date(now.getTime() - HUB_STORAGE_RESERVATION_TTL_MS).toISOString();
  const stale = await database.prepare(`SELECT kind, object_id, profile_id FROM hub_storage_objects
    WHERE state = 'reserved' AND created_at < ? ORDER BY created_at LIMIT 50`).bind(cutoff).all<{ kind: HubStorageKind; object_id: string; profile_id: string }>();
  for (const row of stale.results ?? []) {
    await database.batch(expireReservationStatements(database, row.profile_id, row.kind, row.object_id, now.toISOString()));
  }
  const due = await database.prepare(`SELECT id, kind, profile_id, object_kind, object_id, reservation_id, bytes, attempts
    FROM hub_storage_outbox WHERE delivered_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ${limit}`)
    .bind(now.toISOString()).all<OutboxRow>();
  const tally = { swept: (stale.results ?? []).length, delivered: 0, dropped: 0, failed: 0 };
  for (const row of due.results ?? []) tally[await deliverOutboxRow(database, account, row, now)] += 1;
  return tally;
}
