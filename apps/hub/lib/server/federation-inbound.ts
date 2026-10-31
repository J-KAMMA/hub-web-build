import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { createD1SocialNotification } from "@/lib/server/d1-social-notifications";
import {
  federationConfiguration,
  fetchFederationInbound,
  type FederatedActor,
  type InboundEventPage,
} from "@/lib/server/federation-gateway";
import { hasD1BlockBetween } from "@/lib/server/profile-blocks";

/*
 * Federation の受信箱（GET /v1/inbound）を Hub の表へ取り込む（DESIGN.md 4.1）。
 *
 * - Federation は Hub の D1 を読まず、書きもしない。Hub が引く。
 * - 外部の人は profiles の影の行（kind='remote'、乱数 ID）。actor URL や鍵から ID を作らない。
 * - 外部の投稿・返信は social_posts の行になる。通報・自動保留・凍結・ブロックは既存の経路がそのまま効く。
 * - 取り込みは冪等。origin_object_id と remote_reactions が二重取り込みを防ぐ。
 */

export type InboundActor = FederatedActor | null | undefined;
export type InboundEvent = InboundEventPage["events"][number] & { actor?: InboundActor };

const PULL_BATCH = 50;
const MAX_BATCHES = 6;
const POISON_AFTER_ATTEMPTS = 3;
const STALE_AFTER_MS = 10_000;

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}

function httpUrl(value: unknown, max = 2048): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isoOrNow(value: unknown): string {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return new Date(Number.isFinite(time) ? Math.min(time, Date.now()) : Date.now()).toISOString();
}

function lastPathSegment(actorUrl: string): string {
  try {
    const segment = new URL(actorUrl).pathname.split("/").filter(Boolean).pop() ?? "";
    return segment.replace(/^@/, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  } catch {
    return "";
  }
}

/** domain の方針（suspend）が、この host に及ぶか。完全一致か、親ドメインとして一致。 */
async function hostIsSuspended(database: D1Database, host: string): Promise<boolean> {
  const row = await database.prepare(
    `SELECT 1 AS suspended FROM federation_domain_policies
     WHERE action = 'suspend' AND (domain = ?1 OR substr(?1, -(length(domain) + 1)) = '.' || domain) LIMIT 1`,
  ).bind(host.toLowerCase()).first();
  return Boolean(row);
}

export type ShadowProfile = { profileId: string; handle: string; displayName: string; host: string; actorUrl: string };

/**
 * actor の影のプロフィールを作る（無ければ）／公開情報を更新する。
 * 返す profileId は Hub ローカルの乱数 ID。このプロフィールはログインも Account/ウォレットとの結び付けもできない
 * （0230 のトリガーが D1 側で拒む）。
 */
export async function ensureShadowProfile(database: D1Database, actor: FederatedActor): Promise<ShadowProfile> {
  const actorUrl = httpUrl(actor.id);
  if (!actorUrl) throw new Error("invalid_actor");
  const host = text(actor.host, 255)?.toLowerCase();
  if (!host) throw new Error("invalid_actor");
  const remoteHandle = (actor.handle && /^[A-Za-z0-9_.-]{1,64}$/.test(actor.handle) ? actor.handle : lastPathSegment(actorUrl) || "user").toLowerCase();
  const fullHandle = `${remoteHandle}@${host}`;
  const displayName = (text(actor.displayName, 200) ?? remoteHandle).replace(/\s+/g, " ").trim().slice(0, 80) || remoteHandle;
  // 他のハブの画像URLは保存しない（閲覧者のIPを相手のサーバーへ漏らす・ホットリンクになる）。頭字のアバターで表示する。
  const avatar: string | null = null;
  const now = new Date().toISOString();

  const existing = await database.prepare(
    `SELECT p.id, p.handle FROM remote_actor_profiles r JOIN profiles p ON p.id = r.profile_id WHERE r.actor_url = ? LIMIT 1`,
  ).bind(actorUrl).first<{ id: string; handle: string }>();
  if (existing) {
    await database.batch([
      database.prepare("UPDATE profiles SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ? AND kind = 'remote'")
        .bind(displayName, avatar, now, existing.id),
      database.prepare("UPDATE remote_actor_profiles SET handle = ?, host = ?, profile_url = ?, fetched_at = ? WHERE profile_id = ?")
        .bind(fullHandle, host, httpUrl(actor.url), now, existing.id),
    ]);
    return { profileId: existing.id, handle: existing.handle, displayName, host, actorUrl };
  }

  const profileId = crypto.randomUUID();
  // user@host は 32 字以内なら表示にもそのまま使える。ローカルの handle には @ が入らないので衝突しない。
  const candidates = [fullHandle.length <= 32 ? fullHandle : null, `r~${randomHex(12)}`].filter((value): value is string => Boolean(value));
  let handle: string | null = null;
  for (const candidate of candidates) {
    try {
      await database.batch([
        database.prepare(`INSERT INTO profiles (id, handle, display_name, bio, avatar_url, joined_at, created_at, updated_at, kind)
          VALUES (?, ?, ?, '', ?, ?, ?, ?, 'remote')`).bind(profileId, candidate, displayName, avatar, now, now, now),
        database.prepare(`INSERT INTO remote_actor_profiles (profile_id, actor_url, handle, host, inbox_url, profile_url, fetched_at, created_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`).bind(profileId, actorUrl, fullHandle, host, httpUrl(actor.url), now, now),
      ]);
      handle = candidate;
      break;
    } catch (error) {
      // 同時に同じ actor を作った相手がいれば、そちらを使う。handle の衝突だけなら次の候補へ。
      const raced = await database.prepare("SELECT profile_id FROM remote_actor_profiles WHERE actor_url = ? LIMIT 1")
        .bind(actorUrl).first<{ profile_id: string }>();
      if (raced) return ensureShadowProfile(database, actor);
      if (candidate === candidates.at(-1)) throw error;
    }
  }
  if (!handle) throw new Error("shadow_profile_failed");
  if (await hostIsSuspended(database, host)) await suspendShadowProfile(database, profileId, now);
  return { profileId, handle, displayName, host, actorUrl };
}

async function suspendShadowProfile(database: D1Database, profileId: string, now: string) {
  await database.prepare(
    `INSERT INTO profile_moderation_status (profile_id, status, reason, suspended_at, updated_at)
     VALUES (?, 'suspended', 'federation_domain_suspended', ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET status = 'suspended', reason = 'federation_domain_suspended',
       suspended_at = excluded.suspended_at, updated_at = excluded.updated_at`,
  ).bind(profileId, now, now).run();
}

async function isSuspended(database: D1Database, profileId: string): Promise<boolean> {
  const row = await database.prepare("SELECT 1 AS suspended FROM profile_moderation_status WHERE profile_id = ? AND status = 'suspended' LIMIT 1")
    .bind(profileId).first();
  return Boolean(row);
}

export { isSuspended as isSuspendedProfile };

async function applyNote(database: D1Database, event: InboundEvent): Promise<void> {
  if (!event.actor) return;
  const objectId = httpUrl(event.objectId);
  const content = text(event.content, 20_000);
  if (!objectId || !content) return;
  const already = await database.prepare("SELECT id FROM social_posts WHERE origin_object_id = ? LIMIT 1").bind(objectId).first();
  if (already) return;

  const shadow = await ensureShadowProfile(database, event.actor);
  if (await isSuspended(database, shadow.profileId)) return;

  const localParentId = text(event.replyToHubPostId, 128);
  const remoteParentUrl = httpUrl(event.inReplyTo);
  let parent: { id: string; author_profile_id: string | null } | null = null;
  if (localParentId) {
    parent = await database.prepare("SELECT id, author_profile_id FROM social_posts WHERE id = ? AND moderated_at IS NULL LIMIT 1")
      .bind(localParentId).first();
  } else if (remoteParentUrl) {
    parent = await database.prepare("SELECT id, author_profile_id FROM social_posts WHERE origin_object_id = ? AND moderated_at IS NULL LIMIT 1")
      .bind(remoteParentUrl).first();
  }
  if (localParentId || remoteParentUrl) {
    // 文脈の分からない返信は取り込まない（スレッドの外で単独の発言として見えてしまう）。
    if (!parent) return;
    if (parent.author_profile_id && await hasD1BlockBetween(database, parent.author_profile_id, shadow.profileId)) return;
  } else {
    // トップレベルの投稿は、利用者が承認済みでフォローしている相手の物だけ。フォローを外した後に届いた物は捨てる。
    const followed = await database.prepare(
      "SELECT 1 AS yes FROM remote_follows WHERE remote_profile_id = ? AND state = 'accepted' LIMIT 1",
    ).bind(shadow.profileId).first();
    if (!followed) return;
  }

  const postId = crypto.randomUUID();
  const createdAt = isoOrNow(event.published);
  const inserted = await database.prepare(
    `INSERT OR IGNORE INTO social_posts
       (id, author_profile_id, display_name, handle, identity_mode, body, created_at, reply_to_post_id, audience, origin, origin_object_id)
     VALUES (?, ?, ?, ?, 'account', ?, ?, ?, 'public', 'remote', ?)`,
  ).bind(postId, shadow.profileId, shadow.displayName, shadow.handle, content, createdAt, parent?.id ?? null, objectId).run();
  if (!inserted.meta.changes) return;

  // 取り込んだ返信の宛先が自 Hub の利用者なら、ローカルの返信と同じ通知を出す。
  if (parent?.author_profile_id) {
    await createD1SocialNotification(database, {
      receiverProfileId: parent.author_profile_id,
      actorProfileId: shadow.profileId,
      type: "social_reply",
      targetType: "social_post",
      targetId: postId,
      text: "ポストに返信がありました。",
      preference: "replies",
      createdAt,
    });
  }
}

async function applyNoteUpdate(database: D1Database, event: InboundEvent): Promise<void> {
  const objectId = httpUrl(event.objectId);
  const content = text(event.content, 20_000);
  if (!objectId || !content || !event.actor) return;
  // 本人の投稿だけを書き換える（別 actor が同じ object URL を名乗っても届かない）。
  await database.prepare(
    `UPDATE social_posts SET body = ?
     WHERE origin_object_id = ? AND author_profile_id = (SELECT profile_id FROM remote_actor_profiles WHERE actor_url = ?)`,
  ).bind(content, objectId, event.actor.id).run();
}

async function applyNoteDelete(database: D1Database, event: InboundEvent): Promise<void> {
  const objectId = httpUrl(event.objectId);
  if (!objectId || !event.actor) return;
  await database.prepare(
    `UPDATE social_posts SET moderated_at = COALESCE(moderated_at, ?), moderation_reason = COALESCE(moderation_reason, 'remote_deleted')
     WHERE origin_object_id = ? AND author_profile_id = (SELECT profile_id FROM remote_actor_profiles WHERE actor_url = ?)`,
  ).bind(new Date().toISOString(), objectId, event.actor.id).run();
}

async function applyLike(database: D1Database, event: InboundEvent): Promise<void> {
  const activityId = httpUrl(event.activityId);
  const hubPostId = text(event.hubPostId, 128);
  if (!activityId || !hubPostId || !event.actor) return;
  const known = await database.prepare("SELECT activity_id FROM remote_reactions WHERE activity_id = ?").bind(activityId).first();
  if (known) return;
  const target = await database.prepare(
    "SELECT id, author_profile_id FROM social_posts WHERE id = ? AND origin = 'local' AND moderated_at IS NULL LIMIT 1",
  ).bind(hubPostId).first<{ id: string; author_profile_id: string | null }>();
  if (!target) return;
  const shadow = await ensureShadowProfile(database, event.actor);
  if (await isSuspended(database, shadow.profileId)) return;
  if (target.author_profile_id && await hasD1BlockBetween(database, target.author_profile_id, shadow.profileId)) return;

  const now = new Date().toISOString();
  const reactionId = crypto.randomUUID();
  const inserted = await database.prepare(
    `INSERT INTO reactions (id, target_type, target_id, profile_id, kind, created_at)
     VALUES (?, 'social_post', ?, ?, 'like', ?) ON CONFLICT(profile_id, target_type, target_id) DO NOTHING`,
  ).bind(reactionId, target.id, shadow.profileId, now).run();
  // 同じ人からの二重の Like は、最初の1件だけ数える。Undo はその Like の activity ID だけが取り消せる。
  await database.prepare(
    "INSERT OR IGNORE INTO remote_reactions (activity_id, reaction_id, profile_id, target_id, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(activityId, inserted.meta.changes ? reactionId : null, shadow.profileId, target.id, now).run();
  if (inserted.meta.changes && target.author_profile_id) {
    await createD1SocialNotification(database, {
      receiverProfileId: target.author_profile_id,
      actorProfileId: null,
      safetyActorProfileId: shadow.profileId,
      type: "social_reaction",
      targetType: "social_post",
      targetId: target.id,
      text: "投稿にいいねが付きました。",
      preference: "reactions",
      createdAt: now,
    });
  }
}

async function applyLikeUndone(database: D1Database, event: InboundEvent): Promise<void> {
  const activityId = httpUrl(event.likeActivityId);
  if (!activityId) return;
  const row = await database.prepare("SELECT reaction_id FROM remote_reactions WHERE activity_id = ?")
    .bind(activityId).first<{ reaction_id: string | null }>();
  if (!row) return;
  await database.batch([
    ...(row.reaction_id ? [database.prepare("DELETE FROM reactions WHERE id = ?").bind(row.reaction_id)] : []),
    database.prepare("DELETE FROM remote_reactions WHERE activity_id = ?").bind(activityId),
  ]);
}

async function applyFollowResponse(database: D1Database, event: InboundEvent, accepted: boolean): Promise<void> {
  const followId = text(event.followId, 128);
  if (!followId || !event.actor) return;
  const row = await database.prepare(
    "SELECT follower_profile_id, remote_profile_id FROM remote_follows WHERE federation_follow_id = ?",
  ).bind(followId).first<{ follower_profile_id: string; remote_profile_id: string }>();
  if (!row) return;
  const shadow = await ensureShadowProfile(database, event.actor);
  if (shadow.profileId !== row.remote_profile_id) return;
  const now = new Date().toISOString();
  await database.batch([
    database.prepare("UPDATE remote_follows SET state = ?, updated_at = ? WHERE federation_follow_id = ?")
      .bind(accepted ? "accepted" : "rejected", now, followId),
    ...(accepted
      ? [database.prepare("INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at) VALUES (?, ?, ?)")
          .bind(row.follower_profile_id, row.remote_profile_id, now)]
      : []),
  ]);
}

async function applyFollower(database: D1Database, event: InboundEvent, added: boolean): Promise<void> {
  const localProfileId = text(event.localProfileId, 128);
  if (!localProfileId || !event.actor) return;
  const local = await database.prepare("SELECT id FROM profiles WHERE id = ? AND kind = 'local' LIMIT 1").bind(localProfileId).first();
  if (!local) return;
  const shadow = await ensureShadowProfile(database, event.actor);
  const now = new Date().toISOString();
  if (!added) {
    await database.prepare("DELETE FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ?")
      .bind(shadow.profileId, localProfileId).run();
    return;
  }
  if (await isSuspended(database, shadow.profileId)) return;
  if (await hasD1BlockBetween(database, localProfileId, shadow.profileId)) return;
  const inserted = await database.prepare("INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at) VALUES (?, ?, ?)")
    .bind(shadow.profileId, localProfileId, now).run();
  if (inserted.meta.changes) {
    await createD1SocialNotification(database, {
      receiverProfileId: localProfileId,
      actorProfileId: shadow.profileId,
      type: "followed",
      targetType: "profile",
      targetId: shadow.profileId,
      text: "新しくフォローされました。",
      preference: "follows",
      createdAt: now,
    });
  }
}

async function applyDomainPolicy(database: D1Database, event: InboundEvent): Promise<void> {
  const domain = text(event.domain, 255)?.toLowerCase();
  const action = event.action;
  if (!domain || (action !== "allow" && action !== "limit" && action !== "suspend")) return;
  const now = new Date().toISOString();
  await database.prepare(
    `INSERT INTO federation_domain_policies (domain, action, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET action = excluded.action, updated_at = excluded.updated_at`,
  ).bind(domain, action, now).run();
  const matching = `(r.host = ?1 OR substr(r.host, -(length(?1) + 1)) = '.' || ?1)`;
  if (action === "suspend") {
    // 止めたドメインの人と、その人の投稿・返信・Like は、既存の凍結の経路で画面から消える。
    await database.prepare(
      `INSERT INTO profile_moderation_status (profile_id, status, reason, suspended_at, updated_at)
       SELECT r.profile_id, 'suspended', 'federation_domain_suspended', ?2, ?2 FROM remote_actor_profiles r WHERE ${matching}
       ON CONFLICT(profile_id) DO UPDATE SET status = 'suspended', reason = 'federation_domain_suspended',
         suspended_at = excluded.suspended_at, updated_at = excluded.updated_at`,
    ).bind(domain, now).run();
    return;
  }
  // 解除は、この仕組みで止めた物だけを戻す（運営者が別の理由で凍結した人は戻さない）。
  await database.prepare(
    `UPDATE profile_moderation_status SET status = 'active', suspended_at = NULL, updated_at = ?2
     WHERE reason = 'federation_domain_suspended'
       AND profile_id IN (SELECT r.profile_id FROM remote_actor_profiles r WHERE ${matching})`,
  ).bind(domain, now).run();
}

export async function applyInboundEvent(database: D1Database, event: InboundEvent): Promise<void> {
  switch (event.kind) {
    case "note": return applyNote(database, event);
    case "note_updated": return applyNoteUpdate(database, event);
    case "note_deleted": return applyNoteDelete(database, event);
    case "video": return (await import("@/lib/server/remote-hub-videos")).applyRemoteVideo(database, event);
    case "video_updated": return (await import("@/lib/server/remote-hub-videos")).applyRemoteVideoUpdate(database, event);
    case "video_deleted": return (await import("@/lib/server/remote-hub-videos")).applyRemoteVideoDelete(database, event);
    case "like": return applyLike(database, event);
    case "like_undone": return applyLikeUndone(database, event);
    case "follow_accepted": return applyFollowResponse(database, event, true);
    case "follow_rejected": return applyFollowResponse(database, event, false);
    case "follower_added": return applyFollower(database, event, true);
    case "follower_removed": return applyFollower(database, event, false);
    case "domain_policy": return applyDomainPolicy(database, event);
    case "flag": { await (await import("@/lib/server/federation-flag")).applyRemoteFlag(database, event); return; }
    case "actor_moved": return (await import("@/lib/server/federation-inbound-move")).applyActorMoved(database, event);
    default: return; // 知らない種類は読み飛ばす（新しい Federation と古い Hub が混在しても止まらない）
  }
}

type PullState = { cursor: string; stuck_cursor: string | null; stuck_attempts: number };

export type PullResult = { applied: number; skipped: number; cursor: string; error?: string };

/**
 * Federation の受信箱を cursor から順に取り込む。取り込めない出来事は3回試して読み飛ばす
 * （1件の不具合で、後ろの全部が止まらないように）。
 */
export async function pullFederationInbound(
  database: D1Database,
  fetchPage: typeof fetchFederationInbound = fetchFederationInbound,
): Promise<PullResult> {
  const state = await database.prepare("SELECT cursor, stuck_cursor, stuck_attempts FROM federation_inbound_state WHERE id = 1")
    .first<PullState>() ?? { cursor: "0", stuck_cursor: null, stuck_attempts: 0 };
  let cursor = state.cursor;
  let stuckCursor = state.stuck_cursor;
  let stuckAttempts = state.stuck_attempts;
  let applied = 0;
  let skipped = 0;

  const persist = () => database.prepare(
    `INSERT INTO federation_inbound_state (id, cursor, last_pulled_at, stuck_cursor, stuck_attempts) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor, last_pulled_at = excluded.last_pulled_at,
       stuck_cursor = excluded.stuck_cursor, stuck_attempts = excluded.stuck_attempts`,
  ).bind(cursor, new Date().toISOString(), stuckCursor, stuckAttempts).run();

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const page = await fetchPage(cursor, PULL_BATCH);
    if (!page.ok) {
      await persist();
      return { applied, skipped, cursor, error: page.error };
    }
    for (const event of page.body.events) {
      try {
        await applyInboundEvent(database, event as InboundEvent);
        applied += 1;
        cursor = String(event.seq);
        stuckCursor = null;
        stuckAttempts = 0;
      } catch {
        const seq = String(event.seq);
        stuckAttempts = stuckCursor === seq ? stuckAttempts + 1 : 1;
        stuckCursor = seq;
        if (stuckAttempts >= POISON_AFTER_ATTEMPTS) {
          console.error(JSON.stringify({ event: "federation_inbound_skipped", kind: event.kind, seq: event.seq }));
          skipped += 1;
          cursor = seq;
          stuckCursor = null;
          stuckAttempts = 0;
          continue;
        }
        await persist();
        return { applied, skipped, cursor, error: "event_failed" };
      }
    }
    if (!page.body.hasMore) break;
  }
  await persist();
  return { applied, skipped, cursor };
}

/**
 * 画面を開いたときに呼ぶ軽い取り込み。直前の取り込みから10秒以内なら何もしない。
 * 定期の取り込み（HUB_JOBS）が主で、これは「フォローした直後に見える」ための補助。失敗しても画面は止めない。
 */
export async function pullFederationInboundIfStale(database: D1Database): Promise<void> {
  if (!federationConfiguration()) return;
  try {
    const state = await database.prepare("SELECT last_pulled_at FROM federation_inbound_state WHERE id = 1")
      .first<{ last_pulled_at: string | null }>();
    if (state?.last_pulled_at && Date.now() - Date.parse(state.last_pulled_at) < STALE_AFTER_MS) return;
    await Promise.race([
      pullFederationInbound(database),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } catch {
    // 受信箱に届かなくても画面は表示する。
  }
}
