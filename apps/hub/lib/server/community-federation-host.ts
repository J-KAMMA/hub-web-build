import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { CommunityPermissionError, requireActiveMember } from "@/lib/server/d1-community-channels";
import { consumeD1PostQuota, HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { federationConfiguration } from "@/lib/server/federation-gateway";
import {
  decideFederatedGroupMember,
  decideFederatedGroupObject,
  publishFederatedGroupMessage,
  removeFederatedGroupMember,
  removeFederatedGroupObject,
  upsertFederatedGroup,
  type GroupEvent,
} from "@/lib/server/federation-group-gateway";
import { ensureShadowProfile } from "@/lib/server/federation-inbound";

/*
 * 持ち主の Hub 側: ハブをまたぐコミュニティ（DESIGN.md 4.2, 8.4、所有者決定 2026-10-12）。
 *
 * - 他のハブからの参加は、コミュニティごとの設定（communities.allow_remote_members、既定オフ）。
 *   オン/オフできるのはオーナーとモデレーターだけ。非公開コミュニティはオンにできない。
 * - 外部メンバー（影のプロフィール）は member まで。moderator 以上・ガバナンスは D1 のトリガー（0234）が拒む。
 * - 外部の書き込みは、この Hub の既存の規則（停止・ミュート・タイムアウト・チャンネル権限・低速モード・重複・
 *   リンク数・投稿回数）を通ってから発言になる。通った物だけが Announce される。リンクが多い物は保留。
 * - この Hub の moderator が発言を消す・メンバーを外す/禁止すると、次の同期（reconcile）で Federation へ伝わり、
 *   他のハブへ Delete / Remove / Block が届く。既存の moderation の経路は一切変えていない。
 */

export class CommunityFederationError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 502 | 503) {
    super(message);
    this.name = "CommunityFederationError";
  }
}

const MAX_BODY = 2000;
const HOSTED_BATCH = 25;
const UNSYNCED_BATCH = 50;
const HOLD_LINKS = 3;
const MAX_LINKS = 5;

type CommunityRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: "public" | "approval" | "private";
  lifecycle_status: "active" | "closed";
  allow_remote_members: number;
};

function nowIso() { return new Date().toISOString(); }

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function federationSlug(slug: string, id: string): string {
  const base = slug.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/, "").slice(0, 56);
  return base || `c-${id.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12)}`;
}

async function loadCommunity(database: D1Database, communityId: string): Promise<CommunityRow | null> {
  return database.prepare(
    `SELECT id, slug, name, description, visibility, lifecycle_status, allow_remote_members FROM communities WHERE id = ? LIMIT 1`,
  ).bind(communityId).first<CommunityRow>();
}

/** Federation へ出してよい公開チャンネル。非公開（トークン条件・役職ごとの権限が付く）・アーカイブ済みは出さない。 */
export async function listPublicChannels(database: D1Database, communityId: string) {
  const rows = await database.prepare(
    `SELECT ch.id, ch.name, ch.slowmode_seconds AS slowmodeSeconds FROM community_channels ch
     WHERE ch.community_id = ? AND ch.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM content_access_gates cag WHERE cag.target_type = 'channel' AND cag.target_id = ch.id)
       AND NOT EXISTS (SELECT 1 FROM community_channel_permissions p WHERE p.channel_id = ch.id)
     ORDER BY ch.position, ch.created_at, ch.id`,
  ).bind(communityId).all<{ id: string; name: string; slowmodeSeconds: number }>();
  return rows.results;
}

/* ---------------------------------------------------------------- 設定と Group の同期 */

/** コミュニティの公開状態を Federation の Group へ反映する。内容が前回と同じなら呼ばない。 */
export async function syncFederatedGroup(
  database: D1Database,
  communityId: string,
  options: { force?: boolean } = {},
): Promise<{ ok: true; slug: string | null } | { ok: false; error: string }> {
  const community = await loadCommunity(database, communityId);
  if (!community) return { ok: false, error: "not_found" };
  const state = await database.prepare("SELECT slug, enabled_at, synced_hash FROM community_federation WHERE community_id = ?")
    .bind(communityId).first<{ slug: string; enabled_at: string | null; synced_hash: string | null }>();
  const enabled = community.allow_remote_members === 1 && community.lifecycle_status === "active" && community.visibility !== "private";
  // 一度も公開したことがなく、今も公開しないなら、Federation に何も作らない。
  if (!state && !enabled) return { ok: true, slug: null };
  const channels = enabled ? (await listPublicChannels(database, communityId)).map(({ id, name }) => ({ id, name })) : [];
  const summary = community.description.slice(0, 2000);

  const attempt = async (slug: string) => {
    const payload = { slug, name: community.name.slice(0, 100), summary, enabled, channels };
    const hash = await sha256Hex(JSON.stringify(payload));
    if (!options.force && state?.synced_hash === hash) return { ok: true as const, slug, skipped: true };
    const result = await upsertFederatedGroup(communityId, payload);
    if (!result.ok) return { ok: false as const, error: result.error, slug };
    const settled = result.body.slug;
    await database.prepare(
      `INSERT INTO community_federation (community_id, slug, enabled_at, synced_hash, synced_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(community_id) DO UPDATE SET slug = excluded.slug, enabled_at = COALESCE(community_federation.enabled_at, excluded.enabled_at),
         synced_hash = excluded.synced_hash, synced_at = excluded.synced_at`,
    ).bind(communityId, settled, enabled ? nowIso() : null, hash, nowIso()).run();
    return { ok: true as const, slug: settled, skipped: false };
  };

  let slug = state?.slug ?? federationSlug(community.slug, community.id);
  let result = await attempt(slug);
  if (!result.ok && result.error === "slug_taken" && !state) {
    slug = `${slug.slice(0, 50)}-${(await sha256Hex(community.id)).slice(0, 6)}`;
    result = await attempt(slug);
  }
  return result.ok ? { ok: true, slug: result.slug } : { ok: false, error: result.error };
}

async function requireManager(database: D1Database, communityId: string, profileId: string): Promise<CommunityRow> {
  const community = await loadCommunity(database, communityId);
  if (!community || community.lifecycle_status !== "active") throw new CommunityFederationError("コミュニティが見つかりません。", 404);
  const manager = await database.prepare(
    `SELECT m.role FROM community_memberships m JOIN profiles p ON p.id = m.profile_id
     WHERE m.community_id = ? AND m.profile_id = ? AND m.status = 'active' AND m.role IN ('owner', 'moderator') AND p.kind = 'local'
       AND NOT EXISTS (SELECT 1 FROM profile_moderation_status s WHERE s.profile_id = p.id AND s.status = 'suspended')`,
  ).bind(communityId, profileId).first();
  if (!manager) throw new CommunityFederationError("この設定を変更できるのはオーナーとモデレーターだけです。", 403);
  return community;
}

export type RemoteParticipationState = {
  enabled: boolean;
  visibility: CommunityRow["visibility"];
  address: string | null;
  federationAvailable: boolean;
  members: { active: number; pending: number };
  held: number;
};

function hubHost(): string | null {
  try {
    return new URL(process.env.HUB_PUBLIC_ORIGIN ?? "").host || null;
  } catch {
    return null;
  }
}

export async function readRemoteParticipation(database: D1Database, actorProfileId: string, communityId: string): Promise<RemoteParticipationState> {
  const community = await requireManager(database, communityId, actorProfileId);
  const state = await database.prepare("SELECT slug FROM community_federation WHERE community_id = ?").bind(communityId).first<{ slug: string }>();
  const members = await database.prepare(
    `SELECT state, COUNT(*) AS n FROM community_federated_members WHERE community_id = ? AND state IN ('active', 'pending') GROUP BY state`,
  ).bind(communityId).all<{ state: string; n: number }>();
  const held = await database.prepare("SELECT COUNT(*) AS n FROM community_federated_objects WHERE community_id = ? AND state = 'held'")
    .bind(communityId).first<{ n: number }>();
  const host = hubHost();
  return {
    enabled: community.allow_remote_members === 1,
    visibility: community.visibility,
    address: state && host ? `${state.slug}@${host}` : null,
    federationAvailable: Boolean(federationConfiguration()),
    members: {
      active: Number(members.results.find((row) => row.state === "active")?.n ?? 0),
      pending: Number(members.results.find((row) => row.state === "pending")?.n ?? 0),
    },
    held: Number(held?.n ?? 0),
  };
}

/** 「他のハブからの参加」を切り替える。オーナー/モデレーターだけ。オンにできるのは公開・承認制のコミュニティ。 */
export async function setRemoteParticipation(
  database: D1Database,
  actorProfileId: string,
  communityId: string,
  enabled: boolean,
): Promise<RemoteParticipationState> {
  const community = await requireManager(database, communityId, actorProfileId);
  if (enabled) {
    if (community.visibility === "private") throw new CommunityFederationError("非公開のコミュニティは、他のハブに公開できません。", 409);
    if (!federationConfiguration()) throw new CommunityFederationError("連合のサービスにつなげないため、オンにできません。", 503);
  }
  const now = nowIso();
  if ((community.allow_remote_members === 1) !== enabled) {
    await database.batch([
      database.prepare("UPDATE communities SET allow_remote_members = ?, updated_at = ? WHERE id = ?").bind(enabled ? 1 : 0, now, communityId),
      database.prepare(
        `INSERT INTO community_audit_log (id, community_id, actor_profile_id, target_profile_id, action, detail, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), communityId, actorProfileId, enabled ? "remote_participation_enabled" : "remote_participation_disabled", "{}", now),
      // オンにし直したときは、その時点から先の発言だけを外へ出す（オフの間の発言を遡って出さない）。
      ...(enabled
        ? [database.prepare("UPDATE community_federation SET enabled_at = ? WHERE community_id = ?").bind(now, communityId)]
        : []),
    ]);
  }
  const synced = await syncFederatedGroup(database, communityId, { force: true });
  if (!synced.ok && enabled) {
    await database.prepare("UPDATE communities SET allow_remote_members = 0 WHERE id = ?").bind(communityId).run();
    throw new CommunityFederationError("連合のサービスに反映できませんでした。時間をおいて試してください。", 502);
  }
  return readRemoteParticipation(database, actorProfileId, communityId);
}

/* ---------------------------------------------------------------- 受信（Federation → 持ち主の Hub） */

type ShadowActor = Parameters<typeof ensureShadowProfile>[1];

async function isSuspended(database: D1Database, profileId: string) {
  return Boolean(await database.prepare("SELECT 1 AS s FROM profile_moderation_status WHERE profile_id = ? AND status = 'suspended' LIMIT 1")
    .bind(profileId).first());
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}

async function memberRequested(database: D1Database, event: GroupEvent) {
  const communityId = text(event.groupId, 128);
  const followActivityId = text(event.followActivityId, 2048);
  if (!communityId || !followActivityId || !event.actor) return;
  const community = await loadCommunity(database, communityId);
  if (!community) return;
  const shadow = await ensureShadowProfile(database, event.actor as ShadowActor);
  const now = nowIso();
  const open = community.allow_remote_members === 1 && community.lifecycle_status === "active" && community.visibility !== "private";
  const membership = await database.prepare("SELECT role, status FROM community_memberships WHERE community_id = ? AND profile_id = ?")
    .bind(communityId, shadow.profileId).first<{ role: string; status: string }>();

  let state: "pending" | "active" | "rejected" = "pending";
  const statements = [];
  if (!open || await isSuspended(database, shadow.profileId) || membership?.status === "banned") {
    state = "rejected";
  } else if (membership?.status === "active" || membership?.status === "muted") {
    state = "active";
  } else if (community.visibility === "public") {
    state = "active";
    statements.push(
      database.prepare("INSERT OR IGNORE INTO community_memberships (community_id, profile_id, role, status, joined_at) VALUES (?, ?, 'member', 'active', ?)")
        .bind(communityId, shadow.profileId, now),
      database.prepare("INSERT OR IGNORE INTO community_notification_preferences (community_id, profile_id, updated_at) VALUES (?, ?, ?)")
        .bind(communityId, shadow.profileId, now),
    );
  } else {
    // 承認制: 通常の参加申請と同じ列に積む。モデレーターは既存の承認画面で承認/却下する。
    statements.push(database.prepare(
      `INSERT INTO community_membership_requests (community_id, profile_id, status, created_at) VALUES (?, ?, 'pending', ?)
       ON CONFLICT(community_id, profile_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at,
         resolved_at = NULL, resolved_by_profile_id = NULL, resolution_operation_id = NULL`,
    ).bind(communityId, shadow.profileId, now));
  }
  statements.push(database.prepare(
    `INSERT INTO community_federated_members (community_id, profile_id, actor_url, follow_activity_id, state, synced_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(community_id, profile_id) DO UPDATE SET actor_url = excluded.actor_url, follow_activity_id = excluded.follow_activity_id,
       state = excluded.state, synced_state = 'pending', updated_at = excluded.updated_at`,
  ).bind(communityId, shadow.profileId, event.actor.id, followActivityId, state, now, now));
  await database.batch(statements);
}

async function memberLeft(database: D1Database, event: GroupEvent) {
  const communityId = text(event.groupId, 128);
  if (!communityId || !event.actor) return;
  const row = await database.prepare(
    `SELECT m.profile_id FROM community_federated_members m JOIN remote_actor_profiles r ON r.profile_id = m.profile_id
     WHERE m.community_id = ? AND r.actor_url = ?`,
  ).bind(communityId, event.actor.id).first<{ profile_id: string }>();
  if (!row) return;
  const now = nowIso();
  await database.batch([
    database.prepare("DELETE FROM community_memberships WHERE community_id = ? AND profile_id = ? AND role = 'member' AND status <> 'banned'")
      .bind(communityId, row.profile_id),
    database.prepare("UPDATE community_membership_requests SET status = 'cancelled', resolved_at = ? WHERE community_id = ? AND profile_id = ? AND status = 'pending'")
      .bind(now, communityId, row.profile_id),
    database.prepare(
      "UPDATE community_federated_members SET state = 'left', synced_state = 'left', updated_at = ? WHERE community_id = ? AND profile_id = ?",
    ).bind(now, communityId, row.profile_id),
  ]);
}

type Verdict =
  | { decision: "reject"; reason: string }
  | { decision: "hold"; reason: string; channelId: string; replyToMessageId: string | null }
  | { decision: "accept"; channelId: string; replyToMessageId: string | null };

function composeBody(title: string | null, content: string): string {
  return (title ? `【${title}】\n${content}` : content).trim().slice(0, MAX_BODY);
}

/** 外部メンバーの書き込みを、この Hub の規則に通す。ローカルの投稿（createD1CommunityChannelMessage）と同じ検査。 */
async function evaluatePost(
  database: D1Database,
  community: CommunityRow,
  shadow: { profileId: string },
  input: { channelId: string | null; inReplyTo: string | null; body: string },
): Promise<Verdict> {
  if (community.allow_remote_members !== 1 || community.lifecycle_status !== "active" || community.visibility === "private") {
    return { decision: "reject", reason: "remote_participation_disabled" };
  }
  const member = await database.prepare("SELECT state FROM community_federated_members WHERE community_id = ? AND profile_id = ?")
    .bind(community.id, shadow.profileId).first<{ state: string }>();
  if (member?.state !== "active") return { decision: "reject", reason: "not_a_member" };
  if (await isSuspended(database, shadow.profileId)) return { decision: "reject", reason: "suspended" };

  const channels = await listPublicChannels(database, community.id);
  let replyToMessageId: string | null = null;
  let channelId = input.channelId;
  if (input.inReplyTo) {
    const parent = await database.prepare(
      `SELECT o.message_id AS messageId, m.channel_id AS channelId FROM community_federated_objects o
       JOIN community_channel_messages m ON m.id = o.message_id
       WHERE o.object_url = ? AND o.community_id = ? AND o.state = 'visible'`,
    ).bind(input.inReplyTo, community.id).first<{ messageId: string; channelId: string }>();
    if (!parent) return { decision: "reject", reason: "unknown_parent" };
    replyToMessageId = parent.messageId;
    channelId = parent.channelId;
  }
  const channel = channels.find((entry) => entry.id === (channelId ?? channels[0]?.id));
  if (!channel) return { decision: "reject", reason: "channel_not_public" };

  try {
    await requireActiveMember(database, community.id, shadow.profileId, channel.id);
  } catch (error) {
    if (error instanceof CommunityPermissionError) return { decision: "reject", reason: "member_restricted" };
    throw error;
  }
  if (channel.slowmodeSeconds > 0) {
    const latest = await database.prepare(
      "SELECT created_at AS createdAt FROM community_channel_messages WHERE channel_id = ? AND author_profile_id = ? ORDER BY created_at DESC LIMIT 1",
    ).bind(channel.id, shadow.profileId).first<{ createdAt: string }>();
    if (latest && Date.now() - Date.parse(latest.createdAt) < channel.slowmodeSeconds * 1000) return { decision: "reject", reason: "slowmode" };
  }
  const normalized = input.body.normalize("NFKC").trim();
  const duplicates = await database.prepare(
    "SELECT COUNT(*) AS total FROM community_channel_messages WHERE channel_id = ? AND author_profile_id = ? AND body = ? AND created_at >= ?",
  ).bind(channel.id, shadow.profileId, normalized, new Date(Date.now() - 10 * 60_000).toISOString()).first<{ total: number }>();
  if (Number(duplicates?.total ?? 0) >= 2) return { decision: "reject", reason: "duplicate" };
  const links = (normalized.match(/https?:\/\//giu) ?? []).length;
  if (links > MAX_LINKS) return { decision: "reject", reason: "too_many_links" };

  const profile = await database.prepare("SELECT joined_at AS joinedAt FROM profiles WHERE id = ?").bind(shadow.profileId).first<{ joinedAt: string }>();
  try {
    await consumeD1PostQuota(database, { id: shadow.profileId, joinedAt: profile?.joinedAt ?? nowIso() }, "thread_reply");
  } catch (error) {
    if (error instanceof HubPostRateLimitError) return { decision: "reject", reason: "rate_limited" };
    throw error;
  }
  // リンクが多い書き込みは、モデレーターが見るまで保留する（自動保留）。
  if (links >= HOLD_LINKS) return { decision: "hold", reason: "links", channelId: channel.id, replyToMessageId };
  return { decision: "accept", channelId: channel.id, replyToMessageId };
}

/** 外部メンバーの発言の INSERT 文。発言と対応表の更新を1つの batch に入れるため、文と ID を返す。 */
function remoteMessageStatement(
  database: D1Database,
  input: { channelId: string; profileId: string; body: string; replyToMessageId: string | null; createdAt: string; objectUrl: string },
) {
  const id = crypto.randomUUID();
  const statement = database.prepare(
    `INSERT INTO community_channel_messages
       (id, channel_id, author_profile_id, body, created_at, reply_to_message_id, edited_at, kind, workflow_status, origin, origin_object_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'chat', 'open', 'remote', ?)`,
  ).bind(id, input.channelId, input.profileId, input.body, input.createdAt, input.replyToMessageId, input.objectUrl);
  return { id, statement };
}

async function postReceived(database: D1Database, event: GroupEvent) {
  const communityId = text(event.groupId, 128);
  const objectUrl = text(event.objectId, 2048);
  const content = text(event.content, 20_000) ?? "";
  const title = text(event.title, 300);
  if (!communityId || !objectUrl || !event.actor || (!content && !title)) return;
  if (await database.prepare("SELECT 1 AS x FROM community_federated_objects WHERE object_url = ?").bind(objectUrl).first()) return;
  const community = await loadCommunity(database, communityId);
  if (!community) return;
  const shadow = await ensureShadowProfile(database, event.actor as ShadowActor);
  const now = nowIso();
  const published = typeof event.published === "string" && Number.isFinite(Date.parse(event.published))
    ? new Date(Math.min(Date.parse(event.published), Date.now())).toISOString() : now;
  const body = composeBody(title, content);
  const verdict = await evaluatePost(database, community, shadow, {
    channelId: text(event.channelId, 128),
    inReplyTo: text(event.inReplyTo, 2048),
    body,
  });
  const base = [objectUrl, communityId, shadow.profileId] as const;

  if (verdict.decision === "reject") {
    await database.prepare(
      `INSERT INTO community_federated_objects (object_url, community_id, profile_id, direction, state, synced, reason, created_at, updated_at)
       VALUES (?, ?, ?, 'inbound', 'rejected', 0, ?, ?, ?)`,
    ).bind(...base, verdict.reason, now, now).run();
    return;
  }
  if (verdict.decision === "hold") {
    await database.prepare(
      `INSERT INTO community_federated_objects (object_url, community_id, profile_id, direction, state, synced, reason,
         held_title, held_body, held_channel_id, held_reply_to_message_id, held_published_at, created_at, updated_at)
       VALUES (?, ?, ?, 'inbound', 'held', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(...base, verdict.reason, title, body, verdict.channelId, verdict.replyToMessageId, published, now, now).run();
    return;
  }
  // 発言と対応表は同時に入れる（片方だけ残ると、やり直しのたびに二重の発言になる / 外へ出ない発言が残る）。
  const created = remoteMessageStatement(database, {
    channelId: verdict.channelId, profileId: shadow.profileId, body, replyToMessageId: verdict.replyToMessageId, createdAt: published, objectUrl,
  });
  await database.batch([
    created.statement,
    database.prepare(
      `INSERT INTO community_federated_objects (object_url, community_id, profile_id, message_id, direction, state, synced, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'inbound', 'visible', 0, ?, ?)`,
    ).bind(...base, created.id, now, now),
  ]);
}

async function postUpdated(database: D1Database, event: GroupEvent) {
  const objectUrl = text(event.objectId, 2048);
  const content = text(event.content, 20_000) ?? "";
  const title = text(event.title, 300);
  if (!objectUrl || (!content && !title)) return;
  const row = await database.prepare(
    "SELECT message_id AS messageId, community_id AS communityId, state, synced FROM community_federated_objects WHERE object_url = ? AND direction = 'inbound'",
  ).bind(objectUrl).first<{ messageId: string | null; communityId: string; state: string; synced: number }>();
  if (!row) return;
  const body = composeBody(title, content);
  const now = nowIso();
  if (row.state === "held") {
    await database.prepare("UPDATE community_federated_objects SET held_title = ?, held_body = ?, updated_at = ? WHERE object_url = ?")
      .bind(title, body, now, objectUrl).run();
    return;
  }
  if (row.state !== "visible" || !row.messageId) return;
  await database.batch([
    database.prepare("UPDATE community_channel_messages SET body = ?, edited_at = ? WHERE id = ? AND origin = 'remote'").bind(body, now, row.messageId),
    database.prepare("UPDATE community_federated_objects SET updated_at = ? WHERE object_url = ?").bind(now, objectUrl),
  ]);
  // 内容の変更は、もう announce 済みの物だけ Announce(Update) として配り直す。
  // まだ announce していない物は、announce のときに Federation が最新の内容を配る。
  if (row.synced === 1) await decideFederatedGroupObject(row.communityId, objectUrl, "announce_update");
}

async function postDeletedByAuthor(database: D1Database, event: GroupEvent) {
  const objectUrl = text(event.objectId, 2048);
  if (!objectUrl) return;
  const row = await database.prepare(
    "SELECT message_id AS messageId, community_id AS communityId, state FROM community_federated_objects WHERE object_url = ? AND direction = 'inbound'",
  ).bind(objectUrl).first<{ messageId: string | null; communityId: string; state: string }>();
  if (!row || row.state === "removed") return;
  const now = nowIso();
  await database.batch([
    ...(row.messageId ? [
      database.prepare("DELETE FROM community_channel_messages WHERE id = ? AND origin = 'remote'").bind(row.messageId),
      database.prepare("DELETE FROM notifications WHERE target_type = 'community_message' AND target_id = ?").bind(row.messageId),
    ] : []),
    // Federation は作者の Delete を受けた時点で、配った物を Group の Delete として配り終えている。
    database.prepare("UPDATE community_federated_objects SET state = 'removed', synced = 1, updated_at = ? WHERE object_url = ?").bind(now, objectUrl),
  ]);
}

export async function applyGroupHostEvent(database: D1Database, event: GroupEvent): Promise<void> {
  switch (event.kind) {
    case "member_requested": return memberRequested(database, event);
    case "member_left": return memberLeft(database, event);
    case "post_received": return postReceived(database, event);
    case "post_updated": return postUpdated(database, event);
    case "post_deleted": return postDeletedByAuthor(database, event);
    default: return;
  }
}

/* ---------------------------------------------------------------- 保留の操作（モデレーター） */

export type HeldObject = { objectUrl: string; reason: string | null; body: string; authorHandle: string; authorName: string; createdAt: string };

export async function listHeldObjects(database: D1Database, actorProfileId: string, communityId: string): Promise<HeldObject[]> {
  await requireManager(database, communityId, actorProfileId);
  const rows = await database.prepare(
    `SELECT o.object_url AS objectUrl, o.reason, o.held_body AS body, o.created_at AS createdAt, p.handle AS authorHandle, p.display_name AS authorName
     FROM community_federated_objects o JOIN profiles p ON p.id = o.profile_id
     WHERE o.community_id = ? AND o.state = 'held' ORDER BY o.created_at LIMIT 50`,
  ).bind(communityId).all<HeldObject>();
  return rows.results;
}

export async function decideHeldObject(
  database: D1Database,
  actorProfileId: string,
  communityId: string,
  objectUrl: string,
  decision: "release" | "discard",
): Promise<{ state: "visible" | "rejected" }> {
  const community = await requireManager(database, communityId, actorProfileId);
  const row = await database.prepare(
    `SELECT profile_id AS profileId, held_body AS body, held_channel_id AS channelId, held_reply_to_message_id AS replyTo, held_published_at AS publishedAt
     FROM community_federated_objects WHERE object_url = ? AND community_id = ? AND state = 'held'`,
  ).bind(objectUrl, communityId).first<{ profileId: string; body: string; channelId: string; replyTo: string | null; publishedAt: string }>();
  if (!row) throw new CommunityFederationError("保留中の書き込みが見つかりません。", 404);
  const now = nowIso();
  if (decision === "discard") {
    await database.prepare(
      "UPDATE community_federated_objects SET state = 'rejected', synced = 0, reason = 'discarded_by_moderator', updated_at = ? WHERE object_url = ?",
    ).bind(now, objectUrl).run();
    await pushUnsynced(database);
    return { state: "rejected" };
  }
  if (community.allow_remote_members !== 1) throw new CommunityFederationError("他のハブからの参加がオフです。", 409);
  const created = remoteMessageStatement(database, {
    channelId: row.channelId, profileId: row.profileId, body: row.body, replyToMessageId: row.replyTo, createdAt: row.publishedAt ?? now, objectUrl,
  });
  await database.batch([
    created.statement,
    database.prepare(
      "UPDATE community_federated_objects SET state = 'visible', synced = 0, message_id = ?, updated_at = ? WHERE object_url = ? AND state = 'held'",
    ).bind(created.id, now, objectUrl),
  ]);
  await pushUnsynced(database);
  return { state: "visible" };
}

/* ---------------------------------------------------------------- 同期（reconcile: Hub → Federation） */

/** Hub の判断（承認・却下・除外・禁止）を Federation へ伝え終えていない分を伝える。 */
async function pushUnsynced(database: D1Database) {
  const members = await database.prepare(
    `SELECT community_id AS communityId, profile_id AS profileId, actor_url AS actorUrl, state FROM community_federated_members
     WHERE state <> synced_state AND state IN ('active', 'rejected', 'removed', 'banned') LIMIT ?`,
  ).bind(UNSYNCED_BATCH).all<{ communityId: string; profileId: string; actorUrl: string; state: string }>();
  for (const member of members.results) {
    const result = member.state === "active" ? await decideFederatedGroupMember(member.communityId, member.actorUrl, "accept")
      : member.state === "rejected" ? await decideFederatedGroupMember(member.communityId, member.actorUrl, "reject")
        : await removeFederatedGroupMember(member.communityId, member.actorUrl, member.state === "banned");
    // 相手の側がもう終わっている（404/409）物は、これ以上伝えようがないので済みにする。
    if (result.ok || result.status === 404 || result.status === 409) {
      await database.prepare("UPDATE community_federated_members SET synced_state = state, updated_at = ? WHERE community_id = ? AND profile_id = ?")
        .bind(nowIso(), member.communityId, member.profileId).run();
    }
  }

  const objects = await database.prepare(
    `SELECT object_url AS objectUrl, community_id AS communityId, state FROM community_federated_objects
     WHERE synced = 0 AND direction = 'inbound' AND state IN ('visible', 'rejected', 'removed') ORDER BY updated_at LIMIT ?`,
  ).bind(UNSYNCED_BATCH).all<{ objectUrl: string; communityId: string; state: string }>();
  for (const object of objects.results) {
    const result = object.state === "visible" ? await decideFederatedGroupObject(object.communityId, object.objectUrl, "announce")
      : object.state === "rejected" ? await decideFederatedGroupObject(object.communityId, object.objectUrl, "reject")
        : await removeFederatedGroupObject(object.communityId, object.objectUrl);
    if (result.ok || result.status === 404 || result.status === 409) {
      await database.prepare("UPDATE community_federated_objects SET synced = 1 WHERE object_url = ? AND state = ?").bind(object.objectUrl, object.state).run();
    }
  }
  // この Hub の利用者の発言が消えた分（hosted）も Delete として配る。
  const hosted = await database.prepare(
    `SELECT object_url AS objectUrl, community_id AS communityId FROM community_federated_objects
     WHERE synced = 0 AND direction = 'hosted' AND state = 'removed' LIMIT ?`,
  ).bind(UNSYNCED_BATCH).all<{ objectUrl: string; communityId: string }>();
  for (const object of hosted.results) {
    const result = await removeFederatedGroupObject(object.communityId, object.objectUrl);
    if (result.ok || result.status === 404 || result.status === 409) {
      await database.prepare("UPDATE community_federated_objects SET synced = 1 WHERE object_url = ?").bind(object.objectUrl).run();
    }
  }
}

/** この Hub の利用者の公開チャンネルの発言を、他のハブのメンバーが読めるように Group から出す。オンにした後の発言だけ。 */
async function publishHostedMessages(database: D1Database) {
  const communities = await database.prepare(
    `SELECT c.id AS id, f.enabled_at AS enabledAt, f.hosted_cursor_at AS cursorAt, f.hosted_cursor_id AS cursorId
     FROM communities c JOIN community_federation f ON f.community_id = c.id
     WHERE c.allow_remote_members = 1 AND c.lifecycle_status = 'active' AND c.visibility <> 'private' AND f.enabled_at IS NOT NULL`,
  ).all<{ id: string; enabledAt: string; cursorAt: string | null; cursorId: string | null }>();
  for (const community of communities.results) {
    const channelIds = (await listPublicChannels(database, community.id)).map((channel) => channel.id);
    if (!channelIds.length) continue;
    const placeholders = channelIds.map(() => "?").join(", ");
    const messages = await database.prepare(
      `SELECT m.id, m.channel_id AS channelId, m.body, m.created_at AS createdAt, m.reply_to_message_id AS replyTo,
              p.handle, p.display_name AS displayName
       FROM community_channel_messages m JOIN profiles p ON p.id = m.author_profile_id
       WHERE m.channel_id IN (${placeholders}) AND m.origin = 'local' AND m.bot_id IS NULL
         AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
         AND NOT EXISTS (SELECT 1 FROM community_federated_objects o WHERE o.message_id = m.id)
       ORDER BY m.created_at, m.id LIMIT ?`,
    ).bind(...channelIds, community.cursorAt ?? community.enabledAt, community.cursorAt ?? community.enabledAt, community.cursorId ?? "", HOSTED_BATCH).all<{
      id: string; channelId: string; body: string; createdAt: string; replyTo: string | null; handle: string; displayName: string;
    }>();
    for (const message of messages.results) {
      let parentObject: string | null = null;
      if (message.replyTo) {
        const parent = await database.prepare("SELECT object_url AS objectUrl FROM community_federated_objects WHERE message_id = ? AND state = 'visible'")
          .bind(message.replyTo).first<{ objectUrl: string }>();
        parentObject = parent?.objectUrl ?? null;
      }
      const now = nowIso();
      const advance = () => database.prepare("UPDATE community_federation SET hosted_cursor_at = ?, hosted_cursor_id = ? WHERE community_id = ?")
        .bind(message.createdAt, message.id, community.id).run();
      if (message.replyTo && !parentObject) {
        // 返信先が外に出ていない（オンにする前の発言など）。文脈の無い返信を外へ出さない。
        await database.prepare(
          `INSERT OR IGNORE INTO community_federated_objects (object_url, community_id, message_id, direction, state, synced, reason, created_at, updated_at)
           VALUES (?, ?, ?, 'hosted', 'rejected', 1, 'parent_not_federated', ?, ?)`,
        ).bind(`hub-local:${message.id}`, community.id, message.id, now, now).run();
        await advance();
        continue;
      }
      const published = await publishFederatedGroupMessage(community.id, {
        hubMessageId: message.id,
        text: message.body.slice(0, 1900),
        channelId: message.channelId,
        inReplyToObjectId: parentObject,
        authorName: message.displayName,
        authorHandle: message.handle,
        publishedAt: message.createdAt,
      });
      if (!published.ok) break; // 落ちている間は次の同期で続ける（順序を保つ）
      await database.prepare(
        `INSERT OR IGNORE INTO community_federated_objects (object_url, community_id, message_id, direction, state, synced, created_at, updated_at)
         VALUES (?, ?, ?, 'hosted', 'visible', 1, ?, ?)`,
      ).bind(published.body.objectId, community.id, message.id, now, now).run();
      await advance();
    }
  }
}

/**
 * Hub の状態を Federation へ揃える。取り込みのたびに呼ばれる（落ちていた間の分も次で追いつく）。
 * 1. Group の公開状態（名前・公開チャンネル・オン/オフ）
 * 2. 既存の moderation の結果（メンバーの承認/除外/禁止、発言の削除。D1 のトリガーが印に写している）の Federation への通知
 * 3. この Hub の利用者の発言の公開
 */
export async function reconcileFederatedCommunities(database: D1Database): Promise<void> {
  if (!federationConfiguration()) return;
  const synced = await database.prepare(
    `SELECT c.id AS id FROM communities c WHERE c.allow_remote_members = 1 AND c.lifecycle_status = 'active'
     UNION SELECT f.community_id FROM community_federation f`,
  ).all<{ id: string }>();
  for (const row of synced.results) await syncFederatedGroup(database, row.id);
  await pushUnsynced(database);
  await publishHostedMessages(database);
}
