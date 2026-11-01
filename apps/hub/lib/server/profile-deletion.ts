import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import { releaseHubStorageObject, type HubStorageKind } from "@/lib/server/hub-storage-usage";
import { deleteD1SocialPost, SocialPostActionError } from "@/lib/server/social-post-actions";
import {
  DELETED_USER_NAME,
  PROFILE_DELETION_PLAN,
  type DeletionPlanEntry,
  type DeletionStepName,
} from "@/lib/server/profile-deletion-plan";

/*
 * Profile deletion (owner decision 2026-10-17; docs/hub-privacy/AUDIT.md 2.1 and 7.2-1).
 *
 *   request   POST /api/account/deletion-request records requested_at and execute_after (+30 days).
 *   cancel    DELETE on the same route, until execute_after and until the job has claimed it.
 *   execute   `runProfileDeletions`, from the hourly maintenance job. Before execute_after it does
 *             nothing. After it, the request is claimed once (started_at) and then run step by step.
 *
 * The execution is resumable and idempotent. `hub_profile_deletions.step` is a cursor: each step
 * works in bounded batches, a step that finished is a no-op when repeated, and a crash or a
 * budget stop simply resumes at the stored step on the next hourly run. What happens to each table
 * is the data in profile-deletion-plan.ts, guarded by a test against the real migrations.
 *
 * Nothing here calls the Video Worker, the file component or Account. Work for them is queued in
 * the existing outboxes (hub_video_outbox, hub_storage_outbox, hub_content_files.unpublish_pending)
 * which other maintenance jobs deliver. The Account link is therefore deleted last, after those
 * outboxes have drained (or after 14 days, when Account's own reservation expiry takes over).
 */

export const PROFILE_DELETION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const OUTBOX_WAIT_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH_ROWS = 200;
const ENTRY_CHUNK = 20;
const POST_BATCH = 20;
const DELETED_POST_BODY = "（削除されました）";
const DELETED_FILE_NAME = "deleted";
const DELETED_VIDEO_TITLE = "削除された動画";
const DELETED_ARTICLE_TITLE = "削除された記事";

export const PROFILE_DELETION_STEPS: readonly DeletionStepName[] = [
  "tombstone",
  "access",
  "social_posts",
  "articles",
  "videos",
  "files",
  "code",
  "listings",
  "applications",
  "scrub_names",
  "storage_release",
  "bulk",
  "await_outboxes",
  "finish",
];

/* ------------------------------------------------------------------ request, status, cancel */

export type ProfileDeletionStatus = {
  requestId: string;
  requestedAt: string;
  executeAfter: string;
  state: "scheduled" | "running" | "completed";
  /** True until execute_after, and only while the job has not claimed the request. */
  canCancel: boolean;
};

type ScheduleRow = {
  request_id: string;
  requested_at: string;
  execute_after: string;
  started_at: string | null;
  completed_at: string | null;
};

function toStatus(row: ScheduleRow, now: Date): ProfileDeletionStatus {
  return {
    requestId: row.request_id,
    requestedAt: row.requested_at,
    executeAfter: row.execute_after,
    state: row.completed_at ? "completed" : row.started_at ? "running" : "scheduled",
    canCancel: !row.started_at && !row.completed_at && row.execute_after > now.toISOString(),
  };
}

export async function getProfileDeletionStatus(
  db: D1Database,
  profileId: string,
  now: Date = new Date(),
): Promise<ProfileDeletionStatus | null> {
  const row = await db
    .prepare(`SELECT request_id, requested_at, execute_after, started_at, completed_at
      FROM hub_profile_deletions WHERE profile_id = ? AND cancelled_at IS NULL LIMIT 1`)
    .bind(profileId)
    .first<ScheduleRow>();
  return row ? toStatus(row, now) : null;
}

/** Records the request and its 30-day schedule. Asking again while one is live returns the live one. */
export async function requestProfileDeletion(
  db: D1Database,
  profileId: string,
  now: Date = new Date(),
): Promise<ProfileDeletionStatus> {
  const existing = await getProfileDeletionStatus(db, profileId, now);
  if (existing) return existing;
  const stamp = now.toISOString();
  const executeAfter = new Date(now.getTime() + PROFILE_DELETION_WINDOW_MS).toISOString();
  const requestId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO hub_data_requests (id, profile_id, request_type, status, created_at, updated_at)
      VALUES (?1, ?2, 'deletion', 'open', ?3, ?3)`).bind(requestId, profileId, stamp),
    db.prepare(`INSERT OR IGNORE INTO hub_profile_deletions (request_id, profile_id, requested_at, execute_after, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?3 WHERE EXISTS (SELECT 1 FROM hub_data_requests WHERE id = ?1)`)
      .bind(requestId, profileId, stamp, executeAfter),
  ]);
  let status = await getProfileDeletionStatus(db, profileId, now);
  if (!status) {
    // An open request from before the schedule existed: give it the same window.
    const legacy = await db
      .prepare(`SELECT id FROM hub_data_requests
        WHERE profile_id = ? AND request_type = 'deletion' AND status IN ('open', 'processing') LIMIT 1`)
      .bind(profileId)
      .first<{ id: string }>();
    if (legacy) {
      await db
        .prepare(`INSERT OR IGNORE INTO hub_profile_deletions (request_id, profile_id, requested_at, execute_after, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?3)`)
        .bind(legacy.id, profileId, stamp, executeAfter)
        .run();
      status = await getProfileDeletionStatus(db, profileId, now);
    }
  }
  if (!status) throw new Error("profile_deletion_request_failed");
  return status;
}

/**
 * Cancels a scheduled deletion. Returns false when there is nothing to cancel, the date has
 * passed, or the job has already started (a started deletion cannot be undone).
 */
export async function cancelProfileDeletion(
  db: D1Database,
  profileId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const stamp = now.toISOString();
  const [cancelled] = await db.batch([
    db.prepare(`UPDATE hub_profile_deletions SET cancelled_at = ?1, updated_at = ?1
      WHERE profile_id = ?2 AND cancelled_at IS NULL AND completed_at IS NULL AND started_at IS NULL AND execute_after > ?1`)
      .bind(stamp, profileId),
    // The Hubpedia reader treats open/processing/completed requests as "author asked for deletion".
    db.prepare(`DELETE FROM hub_data_requests WHERE request_type = 'deletion' AND status = 'open'
      AND id IN (SELECT request_id FROM hub_profile_deletions WHERE profile_id = ?2 AND cancelled_at = ?1)`)
      .bind(stamp, profileId),
  ]);
  return Number(cancelled?.meta?.changes ?? 0) > 0;
}

/* ------------------------------------------------------------------ execution */

type Ctx = {
  db: D1Database;
  profileId: string;
  requestId: string;
  now: string;
  nowMs: number;
  budget: { left: number };
  waitingSince: string | null;
};

type StepResult = "done" | "yield" | "wait";

const changesOf = (result: unknown) => Number((result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);

/** Repeats one bounded statement (it must contain LIMIT) until it touches fewer rows than the limit. */
async function drain(ctx: Ctx, sql: string, binds: readonly unknown[], limit = BATCH_ROWS): Promise<StepResult> {
  for (;;) {
    if (ctx.budget.left <= 0) return "yield";
    ctx.budget.left -= 1;
    const result = await ctx.db.prepare(sql).bind(...binds).run();
    if (changesOf(result) < limit) return "done";
  }
}

/** Runs several drains in order; stops at the first that has to yield. */
async function drainAll(ctx: Ctx, statements: readonly { sql: string; binds: readonly unknown[] }[]): Promise<StepResult> {
  for (const statement of statements) {
    const result = await drain(ctx, statement.sql, statement.binds);
    if (result !== "done") return result;
  }
  return "done";
}

async function run(ctx: Ctx, sql: string, ...binds: unknown[]) {
  ctx.budget.left -= 1;
  return ctx.db.prepare(sql).bind(...binds).run();
}

const bounded = (table: string, set: string, where: string) =>
  `UPDATE ${table} SET ${set} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${BATCH_ROWS})`;

function randomHandle(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `deleted-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function entryStatement(db: D1Database, entry: DeletionPlanEntry, profileId: string): D1PreparedStatement {
  const { table, column } = entry;
  const where = `"${column}" = ?1 ${entry.where ?? ""}`;
  return entry.policy === "null"
    ? db.prepare(`UPDATE "${table}" SET "${column}" = NULL WHERE rowid IN (SELECT rowid FROM "${table}" WHERE ${where} LIMIT ${BATCH_ROWS})`).bind(profileId)
    : db.prepare(`DELETE FROM "${table}" WHERE rowid IN (SELECT rowid FROM "${table}" WHERE ${where} LIMIT ${BATCH_ROWS})`).bind(profileId);
}

async function tombstoneHandle(ctx: Ctx): Promise<string> {
  const row = await ctx.db.prepare("SELECT handle FROM profiles WHERE id = ?").bind(ctx.profileId).first<{ handle: string }>();
  ctx.budget.left -= 1;
  return row?.handle ?? randomHandle();
}

/** Delete/null entries in chunks of one batch each, repeating a chunk while any entry hit its row limit. */
async function runEntries(
  ctx: Ctx,
  entries: readonly DeletionPlanEntry[],
  startIndex: number,
  persist: (nextIndex: number) => Promise<void>,
): Promise<StepResult> {
  for (let index = startIndex; index < entries.length; index += ENTRY_CHUNK) {
    let pending = entries.slice(index, index + ENTRY_CHUNK);
    while (pending.length) {
      if (ctx.budget.left <= 0) {
        await persist(index);
        return "yield";
      }
      ctx.budget.left -= 1;
      const results = await ctx.db.batch(pending.map((entry) => entryStatement(ctx.db, entry, ctx.profileId)));
      pending = pending.filter((_, position) => changesOf(results[position]) >= BATCH_ROWS);
    }
    await persist(Math.min(index + ENTRY_CHUNK, entries.length));
  }
  return "done";
}

const ACCESS_ENTRIES = PROFILE_DELETION_PLAN.filter((e) => e.policy === "delete" && e.phase === "access");
const BULK_ENTRIES = PROFILE_DELETION_PLAN.filter((e) => (e.policy === "delete" || e.policy === "null") && e.phase !== "access");

const noopPersist = async () => undefined;

const STEP_RUNNERS: Record<DeletionStepName, (ctx: Ctx, cursor: number, persist: (next: number) => Promise<void>) => Promise<StepResult>> = {
  /*
   * 1. Tombstone. The profiles row stays so RESTRICT references and other users' threads, DMs and
   * community messages keep working. deleted_at also blocks every new session (migration trigger).
   */
  async tombstone(ctx) {
    const row = await ctx.db.prepare("SELECT deleted_at FROM profiles WHERE id = ?").bind(ctx.profileId).first<{ deleted_at: string | null }>();
    ctx.budget.left -= 1;
    if (!row || row.deleted_at) return "done";
    await run(
      ctx,
      `UPDATE profiles SET handle = ?1, display_name = ?2, bio = '', avatar_url = NULL, deleted_at = ?3, updated_at = ?3
        WHERE id = ?4 AND deleted_at IS NULL`,
      randomHandle(),
      DELETED_USER_NAME,
      ctx.now,
      ctx.profileId,
    );
    return "done";
  },

  /* 2. Sessions, credentials, passkeys, wallet links and agent grants. */
  async access(ctx) {
    await run(
      ctx,
      "UPDATE hub_agent_grants SET revoked_at = COALESCE(revoked_at, ?1), label = '' WHERE profile_id = ?2 AND (revoked_at IS NULL OR label <> '')",
      ctx.now,
      ctx.profileId,
    );
    return runEntries(ctx, ACCESS_ENTRIES, 0, noopPersist);
  },

  /*
   * 3. Own top-level social posts and reposts: deleted through the existing per-post delete
   * (soft delete + reactions, bookmarks, pushes, tags, notifications), then the text is replaced,
   * revisions and the gate are removed. Replies to other people's posts stay, shown as the deleted user.
   */
  async social_posts(ctx) {
    const images = await drain(ctx, bounded("social_post_images", "status = 'deleted'", "owner_profile_id = ?1 AND status <> 'deleted'"), [ctx.profileId]);
    if (images !== "done") return images;
    const handle = await tombstoneHandle(ctx);
    for (;;) {
      if (ctx.budget.left < 4) return "yield";
      ctx.budget.left -= 1;
      const { results } = await ctx.db
        .prepare(`SELECT id, moderated_at, moderation_reason FROM social_posts
          WHERE author_profile_id = ?1 AND body <> ?2
            AND (reply_to_post_id IS NULL OR reply_to_post_id IN (SELECT id FROM social_posts WHERE author_profile_id = ?1))
          LIMIT ${POST_BATCH}`)
        .bind(ctx.profileId, DELETED_POST_BODY)
        .all<{ id: string; moderated_at: string | null; moderation_reason: string | null }>();
      const posts = results ?? [];
      if (!posts.length) break;
      for (const post of posts) {
        // Each post costs at most three round trips; stop cleanly and pick up here next run.
        if (ctx.budget.left < 4) return "yield";
        if (!post.moderated_at) {
          try {
            ctx.budget.left -= 2;
            await deleteD1SocialPost(ctx.db, post.id, ctx.profileId);
          } catch (error) {
            // Already gone or hidden by moderation: the text is still replaced below.
            if (!(error instanceof SocialPostActionError)) throw error;
          }
        }
        ctx.budget.left -= 1;
        await ctx.db.batch([
          ctx.db.prepare(`UPDATE social_posts SET body = ?1, display_name = ?2, handle = ?3,
              repost_of_target_type = NULL, repost_of_target_id = NULL, quote_of_target_type = NULL, quote_of_target_id = NULL
            WHERE id = ?4 AND author_profile_id = ?5`)
            .bind(DELETED_POST_BODY, DELETED_USER_NAME, handle, post.id, ctx.profileId),
          ctx.db.prepare("DELETE FROM social_post_revisions WHERE post_id = ?").bind(post.id),
          ctx.db.prepare("DELETE FROM content_access_gates WHERE target_type = 'post' AND target_id = ?").bind(post.id),
          ctx.db.prepare("DELETE FROM content_tag_links WHERE target_type = 'social_post' AND target_id = ?").bind(post.id),
          ctx.db.prepare("DELETE FROM reactions WHERE target_type = 'social_post' AND target_id = ?").bind(post.id),
          ctx.db.prepare("DELETE FROM bookmarks WHERE target_type = 'social_post' AND target_id = ?").bind(post.id),
        ]);
      }
    }
    // Replies that stay: scrub the copied name and handle, and drop older versions of their text.
    return drainAll(ctx, [
      {
        sql: bounded("social_posts", "display_name = ?2, handle = ?3", "author_profile_id = ?1 AND (display_name <> ?2 OR handle IS NOT ?3)"),
        binds: [ctx.profileId, DELETED_USER_NAME, handle],
      },
      {
        sql: `DELETE FROM social_post_revisions WHERE rowid IN (SELECT r.rowid FROM social_post_revisions r
          JOIN social_posts p ON p.id = r.post_id WHERE p.author_profile_id = ?1 LIMIT ${BATCH_ROWS})`,
        binds: [ctx.profileId],
      },
    ]);
  },

  /*
   * 4. Published articles: like social posts, the row stays (other people's comments on it must
   * survive as comments by/under the deleted user's article) but the article is withdrawn and its text,
   * summary, thumbnail and tags are replaced, the way the copyright takedown scrubs one. The author's
   * own metadata (gate, likes, bookmarks, saves, series and magazine links, daily stats, tags,
   * revisions) is deleted. Drafts and revisions authored by the user go in the bulk step.
   */
  async articles(ctx) {
    for (;;) {
      if (ctx.budget.left < 3) return "yield";
      ctx.budget.left -= 1;
      const { results } = await ctx.db
        .prepare(`SELECT id FROM hub_user_articles
          WHERE author_profile_id = ?1 AND NOT (status = 'withdrawn' AND title = ?2 AND body = ?3 AND summary = '' AND thumbnail_url IS NULL AND tags_json = '[]')
          LIMIT 20`)
        .bind(ctx.profileId, DELETED_ARTICLE_TITLE, DELETED_POST_BODY)
        .all<{ id: string }>();
      const ids = (results ?? []).map((row) => row.id);
      if (!ids.length) return "done";
      const marks = ids.map(() => "?").join(",");
      ctx.budget.left -= 1;
      await ctx.db.batch([
        ctx.db.prepare(`DELETE FROM content_access_gates WHERE target_type = 'article' AND target_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM reactions WHERE target_type = 'user_article' AND target_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM bookmarks WHERE target_type = 'user_article' AND target_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM notifications WHERE target_type = 'user_article' AND target_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM hub_user_article_saves WHERE article_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM hub_user_article_tags WHERE article_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM content_tag_links WHERE target_type = 'user_article' AND target_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM hub_user_article_daily_stats WHERE article_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM hub_user_article_series_items WHERE article_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM hub_user_article_magazine_items WHERE article_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`DELETE FROM hub_user_article_revisions WHERE article_id IN (${marks})`).bind(...ids),
        ctx.db.prepare(`UPDATE hub_user_articles SET status = 'withdrawn', title = ?, body = ?, summary = '', thumbnail_url = NULL, tags_json = '[]', updated_at = ?
          WHERE author_profile_id = ? AND id IN (${marks})`).bind(DELETED_ARTICLE_TITLE, DELETED_POST_BODY, ctx.now, ctx.profileId, ...ids),
      ]);
    }
  },

  /*
   * 5. Videos: same state change as deleteHubVideo (deleted, gate removed), but the Video Worker is
   * only told through hub_video_outbox ('delete' also finishes the Account storage steps).
   */
  async videos(ctx) {
    for (;;) {
      if (ctx.budget.left < 3) return "yield";
      ctx.budget.left -= 1;
      const { results } = await ctx.db
        .prepare("SELECT id FROM hub_videos WHERE profile_id = ? AND state <> 'deleted' LIMIT 10")
        .bind(ctx.profileId)
        .all<{ id: string }>();
      const ids = (results ?? []).map((row) => row.id);
      if (!ids.length) break;
      const statements: D1PreparedStatement[] = [];
      for (const id of ids) {
        statements.push(
          ctx.db.prepare(`UPDATE hub_videos SET state = 'deleted', deleted_at = ?1, unpublished_at = COALESCE(unpublished_at, ?1), updated_at = ?1
            WHERE id = ?2 AND profile_id = ?3 AND state <> 'deleted'`).bind(ctx.now, id, ctx.profileId),
          // Comments first, so removing the gate never leaves ungated comments of a deleted video.
          ctx.db.prepare("DELETE FROM social_posts WHERE reply_to_video_id = ?").bind(id),
          ctx.db.prepare("DELETE FROM content_access_gates WHERE target_type = 'video' AND target_id = ?").bind(id),
          ctx.db.prepare("DELETE FROM hub_video_outbox WHERE video_id = ?").bind(id),
          ctx.db.prepare("DELETE FROM content_tag_links WHERE target_type = 'video' AND target_id = ?").bind(id),
          ctx.db.prepare(`INSERT INTO hub_video_outbox (id, video_id, kind, attempts, next_attempt_at, created_at)
            VALUES (?1, ?2, 'delete', 0, ?3, ?3)
            ON CONFLICT(video_id, kind) DO UPDATE SET next_attempt_at = excluded.next_attempt_at`).bind(crypto.randomUUID(), id, ctx.now),
        );
      }
      ctx.budget.left -= 1;
      await ctx.db.batch(statements);
    }
    return drain(
      ctx,
      bounded("hub_videos", "title = ?2, description = '', tags_json = '[]'", "profile_id = ?1 AND (title <> ?2 OR description <> '' OR tags_json <> '[]')"),
      [ctx.profileId, DELETED_VIDEO_TITLE],
    );
  },

  /* 6. Gated files: unpublish through the existing retry job (ticketed call to the file component). */
  async files(ctx) {
    return drainAll(ctx, [
      {
        sql: bounded("hub_content_files", "state = 'unpublish_pending', updated_at = ?2", "owner_profile_id = ?1 AND state = 'published'"),
        binds: [ctx.profileId, ctx.now],
      },
      {
        sql: bounded("hub_content_files", "state = 'removed', updated_at = ?2", "owner_profile_id = ?1 AND state IN ('upload_issued', 'unpublished')"),
        binds: [ctx.profileId, ctx.now],
      },
    ]);
  },

  /* 7. Code: tokens revoked, repositories private, push reservations released through the storage outbox. */
  async code(ctx) {
    await run(
      ctx,
      "UPDATE code_access_tokens SET revoked_at = COALESCE(revoked_at, ?1), label = '' WHERE owner_profile_id = ?2 AND (revoked_at IS NULL OR label <> '')",
      ctx.now,
      ctx.profileId,
    );
    const repos = await drain(
      ctx,
      bounded("code_repositories", "visibility = 'private', description = '', updated_at = ?2", "owner_profile_id = ?1 AND (visibility <> 'private' OR description <> '')"),
      [ctx.profileId, ctx.now],
    );
    if (repos !== "done") return repos;
    for (;;) {
      if (ctx.budget.left < 3) return "yield";
      ctx.budget.left -= 1;
      const { results } = await ctx.db
        .prepare(`SELECT jti, reservation_id, COALESCE(bytes, 0) AS bytes FROM code_repository_pushes
          WHERE profile_id = ? AND state IN ('reserved', 'committed') LIMIT 50`)
        .bind(ctx.profileId)
        .all<{ jti: string; reservation_id: string; bytes: number }>();
      const pushes = results ?? [];
      if (!pushes.length) return "done";
      ctx.budget.left -= 1;
      await ctx.db.batch([
        ...pushes.map((push) =>
          ctx.db.prepare(`INSERT INTO hub_storage_outbox (id, kind, profile_id, object_kind, object_id, reservation_id, bytes, next_attempt_at, created_at)
            VALUES (?1, 'release', ?2, 'code_push', ?3, ?4, ?5, ?6, ?6)`)
            .bind(crypto.randomUUID(), ctx.profileId, push.jti, push.reservation_id, push.bytes, ctx.now)),
        ctx.db.prepare(`UPDATE code_repository_pushes SET state = 'released', settled_at = ?1
          WHERE profile_id = ?2 AND jti IN (${pushes.map(() => "?").join(",")})`)
          .bind(ctx.now, ctx.profileId, ...pushes.map((push) => push.jti)),
      ]);
    }
  },

  /* 8. Listings and works other people depend on: withdrawn from view, not deleted. */
  async listings(ctx) {
    return drainAll(ctx, [
      { sql: bounded("classified_listings", "status = 'paused', closed_reason = 'account_deleted', updated_at = ?2", "owner_profile_id = ?1 AND status <> 'paused'"), binds: [ctx.profileId, ctx.now] },
      { sql: bounded("public_listings", "status = 'paused', updated_at = ?2", "owner_profile_id = ?1 AND status <> 'paused'"), binds: [ctx.profileId, ctx.now] },
      { sql: bounded("work_listings", "status = 'paused', updated_at = ?2", "owner_profile_id = ?1 AND status <> 'paused'"), binds: [ctx.profileId, ctx.now] },
      { sql: bounded("music_works", "status = 'removed', updated_at = ?2", "submitted_by_profile_id = ?1 AND status <> 'removed'"), binds: [ctx.profileId, ctx.now] },
    ]);
  },

  /* 9. Job applications: free text cleared (the columns anonymizeExpiredJobApplications clears). */
  async applications(ctx) {
    return drain(
      ctx,
      bounded(
        "job_applications",
        "cover_note = '', experience = '', skills_json = '[]', desired_conditions = '', available_from = NULL, anonymized_at = ?2, updated_at = ?2",
        "applicant_profile_id = ?1 AND anonymized_at IS NULL",
      ),
      [ctx.profileId, ctx.now],
    );
  },

  /* 10. The copied display name on posts in threads that stay. */
  async scrub_names(ctx) {
    return drain(
      ctx,
      bounded("thread_posts", "display_name = ?2", "author_profile_id = ?1 AND is_anonymous = 0 AND display_name <> ?2"),
      [ctx.profileId, DELETED_USER_NAME],
    );
  },

  /* 11. Queue the release of every committed storage object (the Account link is still in place). */
  async storage_release(ctx) {
    for (;;) {
      if (ctx.budget.left < 4) return "yield";
      ctx.budget.left -= 1;
      const { results } = await ctx.db
        .prepare("SELECT kind, object_id FROM hub_storage_objects WHERE profile_id = ? AND state = 'committed' LIMIT 25")
        .bind(ctx.profileId)
        .all<{ kind: HubStorageKind; object_id: string }>();
      const objects = results ?? [];
      if (!objects.length) return "done";
      for (const object of objects) {
        if (ctx.budget.left < 2) return "yield";
        ctx.budget.left -= 1;
        await releaseHubStorageObject(ctx.db, object.kind, object.object_id);
      }
    }
  },

  /* 12. Everything purely personal, and the profile IDs that are not our record to keep. */
  async bulk(ctx, cursor, persist) {
    return runEntries(ctx, BULK_ENTRIES, cursor, persist);
  },

  /* 13. Wait until Account, the Video Worker and the file component have been told. */
  async await_outboxes(ctx) {
    const pending = await ctx.db
      .prepare(`SELECT
          EXISTS(SELECT 1 FROM hub_storage_outbox WHERE profile_id = ?1 AND delivered_at IS NULL) AS storage,
          EXISTS(SELECT 1 FROM hub_video_outbox o JOIN hub_videos v ON v.id = o.video_id WHERE v.profile_id = ?1) AS video,
          EXISTS(SELECT 1 FROM hub_content_files WHERE owner_profile_id = ?1 AND state = 'unpublish_pending') AS files`)
      .bind(ctx.profileId)
      .first<{ storage: number; video: number; files: number }>();
    ctx.budget.left -= 1;
    if (!pending || (!pending.storage && !pending.video && !pending.files)) return "done";
    if (ctx.waitingSince && ctx.nowMs - Date.parse(ctx.waitingSince) > OUTBOX_WAIT_LIMIT_MS) {
      console.warn(JSON.stringify({ event: "profile_deletion_outbox_wait_expired", request: ctx.requestId }));
      return "done";
    }
    return "wait";
  },

  /* 14. Storage counters, Account links (last), file names; then the request is complete. */
  async finish(ctx) {
    const result = await drainAll(ctx, [
      { sql: `DELETE FROM hub_storage_outbox WHERE rowid IN (SELECT rowid FROM hub_storage_outbox WHERE profile_id = ?1 LIMIT ${BATCH_ROWS})`, binds: [ctx.profileId] },
      { sql: `DELETE FROM hub_storage_objects WHERE rowid IN (SELECT rowid FROM hub_storage_objects WHERE profile_id = ?1 LIMIT ${BATCH_ROWS})`, binds: [ctx.profileId] },
      { sql: `DELETE FROM hub_storage_usage WHERE rowid IN (SELECT rowid FROM hub_storage_usage WHERE profile_id = ?1 LIMIT ${BATCH_ROWS})`, binds: [ctx.profileId] },
      { sql: `DELETE FROM hub_storage_notices WHERE rowid IN (SELECT rowid FROM hub_storage_notices WHERE profile_id = ?1 LIMIT ${BATCH_ROWS})`, binds: [ctx.profileId] },
      { sql: `DELETE FROM account_profile_links WHERE rowid IN (SELECT rowid FROM account_profile_links WHERE profile_id = ?1 LIMIT ${BATCH_ROWS})`, binds: [ctx.profileId] },
      { sql: `DELETE FROM desktop_account_profile_links WHERE rowid IN (SELECT rowid FROM desktop_account_profile_links WHERE profile_id = ?1 LIMIT ${BATCH_ROWS})`, binds: [ctx.profileId] },
      {
        sql: bounded("hub_content_files", "file_name = ?2, state = CASE WHEN state IN ('upload_issued', 'unpublished') THEN 'removed' ELSE state END", "owner_profile_id = ?1 AND file_name <> ?2"),
        binds: [ctx.profileId, DELETED_FILE_NAME],
      },
    ]);
    if (result !== "done") return result;
    ctx.budget.left -= 1;
    await ctx.db.batch([
      ctx.db.prepare("UPDATE hub_data_requests SET status = 'completed', updated_at = ?1 WHERE id = ?2").bind(ctx.now, ctx.requestId),
      ctx.db.prepare("UPDATE hub_profile_deletions SET completed_at = ?1, step = 'done', updated_at = ?1 WHERE request_id = ?2").bind(ctx.now, ctx.requestId),
    ]);
    return "done";
  },
};

type DueRow = {
  request_id: string;
  profile_id: string;
  step: string;
  started_at: string | null;
  waiting_since: string | null;
};

function parseCursor(step: string): { name: DeletionStepName; index: number } {
  const [rawName, rawIndex] = step.split(":");
  const name = (PROFILE_DELETION_STEPS as readonly string[]).includes(rawName ?? "") ? (rawName as DeletionStepName) : "tombstone";
  const index = Number(rawIndex);
  return { name, index: Number.isInteger(index) && index > 0 ? index : 0 };
}

export type ProfileDeletionRunSummary = {
  claimed: number;
  completed: number;
  waiting: number;
  yielded: number;
  failed: number;
};

/** One request, from its stored step to the end, the budget, or a wait. */
async function runRequest(db: D1Database, row: DueRow, now: Date, budget: { left: number }): Promise<"completed" | "waiting" | "yielded"> {
  const ctx: Ctx = {
    db,
    profileId: row.profile_id,
    requestId: row.request_id,
    now: now.toISOString(),
    nowMs: now.getTime(),
    budget,
    waitingSince: row.waiting_since,
  };
  let cursor = parseCursor(row.step);
  for (let position = PROFILE_DELETION_STEPS.indexOf(cursor.name); position < PROFILE_DELETION_STEPS.length; position += 1) {
    const name = PROFILE_DELETION_STEPS[position]!;
    const persist = async (next: number) => {
      await db.prepare("UPDATE hub_profile_deletions SET step = ?, updated_at = ? WHERE request_id = ?")
        .bind(`${name}:${next}`, ctx.now, row.request_id).run();
    };
    const startIndex = name === cursor.name ? cursor.index : 0;
    const result = await STEP_RUNNERS[name](ctx, startIndex, persist);
    if (result === "yield") return "yielded";
    if (result === "wait") {
      await db.prepare("UPDATE hub_profile_deletions SET step = ?, waiting_since = COALESCE(waiting_since, ?), updated_at = ? WHERE request_id = ?")
        .bind(name, ctx.now, ctx.now, row.request_id).run();
      return "waiting";
    }
    if (name === "finish") return "completed";
    const next = PROFILE_DELETION_STEPS[position + 1]!;
    await db.prepare("UPDATE hub_profile_deletions SET step = ?, updated_at = ? WHERE request_id = ?")
      .bind(next, ctx.now, row.request_id).run();
    cursor = { name: next, index: 0 };
  }
  return "completed";
}

/**
 * Hourly maintenance. Claims requests whose execute_after has passed and continues the ones already
 * started. Does nothing before execute_after. Safe to run twice at once for the same request only
 * in the sense that every step is idempotent; the claim itself is a single conditional UPDATE.
 */
export async function runProfileDeletions(
  db: D1Database,
  options: { now?: Date; maxRequests?: number; maxStatements?: number } = {},
): Promise<ProfileDeletionRunSummary> {
  const now = options.now ?? new Date();
  const summary: ProfileDeletionRunSummary = { claimed: 0, completed: 0, waiting: 0, yielded: 0, failed: 0 };
  const budget = { left: Math.max(20, Math.trunc(options.maxStatements ?? 400)) };
  const { results } = await db
    .prepare(`SELECT request_id, profile_id, step, started_at, waiting_since FROM hub_profile_deletions
      WHERE cancelled_at IS NULL AND completed_at IS NULL AND (started_at IS NOT NULL OR execute_after <= ?1)
      ORDER BY execute_after LIMIT ?2`)
    .bind(now.toISOString(), Math.min(10, Math.max(1, Math.trunc(options.maxRequests ?? 3))))
    .all<DueRow>();
  for (const row of results ?? []) {
    if (budget.left <= 0) {
      summary.yielded += 1;
      continue;
    }
    try {
      if (!row.started_at) {
        const claim = await db
          .prepare(`UPDATE hub_profile_deletions SET started_at = ?1, step = 'tombstone', updated_at = ?1
            WHERE request_id = ?2 AND started_at IS NULL AND cancelled_at IS NULL AND completed_at IS NULL AND execute_after <= ?1`)
          .bind(now.toISOString(), row.request_id)
          .run();
        if (!changesOf(claim)) continue;
        await db.prepare("UPDATE hub_data_requests SET status = 'processing', updated_at = ?1 WHERE id = ?2 AND status = 'open'")
          .bind(now.toISOString(), row.request_id).run();
        summary.claimed += 1;
        row.step = "tombstone";
      }
      const outcome = await runRequest(db, row, now, budget);
      if (outcome === "completed") summary.completed += 1;
      else if (outcome === "waiting") summary.waiting += 1;
      else summary.yielded += 1;
    } catch (error) {
      summary.failed += 1;
      await db.prepare("UPDATE hub_profile_deletions SET attempts = attempts + 1, updated_at = ? WHERE request_id = ?")
        .bind(now.toISOString(), row.request_id).run().catch(() => undefined);
      // Error text from SQLite names a table or constraint, never a row value.
      console.warn(JSON.stringify({ event: "profile_deletion_step_failed", step: row.step, message: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    }
  }
  return summary;
}
