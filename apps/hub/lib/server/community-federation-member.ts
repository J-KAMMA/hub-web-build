import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { consumeD1PostQuota } from "@/lib/server/d1-rate-limit";
import { federationConfiguration } from "@/lib/server/federation-gateway";
import {
  deleteFederatedGroupPost,
  postToFederatedGroup,
  subscribeToFederatedGroup,
  unsubscribeFromFederatedGroup,
  type GroupEvent,
} from "@/lib/server/federation-group-gateway";

/*
 * 参加する側の Hub: 他のハブのコミュニティに入り、読み、書く（DESIGN.md 4.2, 8.4）。
 *
 * - 参加は Follow。持ち主の Hub が受け入れる（Accept）まで pending で、書き込めない。
 * - 表示するのは、持ち主の Hub が Announce した発言だけ（remote_community_items）。自分が送った書き込みも、
 *   持ち主の Hub が通して Announce し直すまでは画面に出ない。
 * - コミュニティの権限（モデレーター・ガバナンス）はここには無い。持ち主の Hub が消した物は Delete で消える。
 */

const ERRORS: Record<string, { message: string; status: number }> = {
  invalid_handle: { message: "コミュニティは「名前@ホスト」の形で入力してください。", status: 400 },
  unsupported_host: { message: "このホストにはつなげません。", status: 400 },
  cannot_join_local_group: { message: "このハブのコミュニティは、通常の参加を使ってください。", status: 400 },
  group_not_available: { message: "そのコミュニティは見つからないか、他のハブからの参加を受け付けていません。", status: 404 },
  not_a_group: { message: "それはコミュニティではありません。", status: 400 },
  banned_from_group: { message: "このコミュニティには参加できません。", status: 403 },
  domain_suspended: { message: "このハブとはつながらない設定になっています。", status: 403 },
  federation_not_enabled: { message: "他のハブのコミュニティに入るには、設定で連合を有効にしてください。", status: 409 },
  federation_unavailable: { message: "連合のサービスにつなげませんでした。", status: 503 },
  not_a_member: { message: "このコミュニティにはまだ参加していません（持ち主のハブの承認待ちです）。", status: 409 },
  unknown_channel: { message: "そのチャンネルはありません。", status: 400 },
  content_too_long: { message: "投稿が長すぎます（本文1900字・題名100字まで）。", status: 400 },
};

export type RemoteCommunityResult<T> = ({ ok: true } & T) | { ok: false; error: string; message: string; status: number };

/** status を渡せばそれを使う。渡さなければ、エラーごとの既定の状態コード（無ければ 502）。 */
function failure(code: string, status?: number): { ok: false; error: string; message: string; status: number } {
  const known = ERRORS[code];
  return { ok: false, error: code, message: known?.message ?? "操作を完了できませんでした。", status: status ?? known?.status ?? 502 };
}

function nowIso() { return new Date().toISOString(); }

function hubHost(): string | null {
  try {
    return new URL(process.env.HUB_PUBLIC_ORIGIN ?? "").host || null;
  } catch {
    return null;
  }
}

type GroupInfo = { id: string; slug: string; host: string; name: string; summary: string; channels: unknown };

async function upsertRemoteCommunity(database: D1Database, group: GroupInfo): Promise<string> {
  const now = nowIso();
  const existing = await database.prepare("SELECT id FROM remote_communities WHERE group_url = ?").bind(group.id).first<{ id: string }>();
  const channels = JSON.stringify(Array.isArray(group.channels) ? group.channels.slice(0, 100) : []);
  if (existing) {
    await database.prepare("UPDATE remote_communities SET slug = ?, host = ?, name = ?, summary = ?, channels_json = ?, updated_at = ? WHERE id = ?")
      .bind(group.slug, group.host, group.name.slice(0, 100), group.summary.slice(0, 500), channels, now, existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await database.prepare(
    `INSERT INTO remote_communities (id, group_url, slug, host, name, summary, channels_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, group.id, group.slug, group.host, group.name.slice(0, 100), group.summary.slice(0, 500), channels, now, now).run();
  return id;
}

export async function joinRemoteCommunity(
  database: D1Database,
  viewerProfileId: string,
  target: { handle: string } | { groupUrl: string },
): Promise<RemoteCommunityResult<{ remoteCommunityId: string; state: string; name: string; host: string }>> {
  if (!federationConfiguration()) return failure("federation_unavailable", 503);
  const result = await subscribeToFederatedGroup(viewerProfileId, target);
  if (!result.ok) return failure(result.error);
  const remoteCommunityId = await upsertRemoteCommunity(database, result.body.group);
  const state = result.body.state === "undone" ? "left" : result.body.state;
  const now = nowIso();
  await database.prepare(
    `INSERT INTO remote_community_subscriptions (remote_community_id, profile_id, federation_subscription_id, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(remote_community_id, profile_id) DO UPDATE SET federation_subscription_id = excluded.federation_subscription_id,
       state = excluded.state, updated_at = excluded.updated_at`,
  ).bind(remoteCommunityId, viewerProfileId, result.body.subscriptionId, state, now, now).run();
  return { ok: true, remoteCommunityId, state, name: result.body.group.name, host: result.body.group.host };
}

export async function leaveRemoteCommunity(database: D1Database, viewerProfileId: string, remoteCommunityId: string): Promise<RemoteCommunityResult<{ left: true }>> {
  const row = await database.prepare(
    "SELECT federation_subscription_id AS subscriptionId, state FROM remote_community_subscriptions WHERE remote_community_id = ? AND profile_id = ?",
  ).bind(remoteCommunityId, viewerProfileId).first<{ subscriptionId: string; state: string }>();
  if (!row) return failure("not_a_member", 404);
  if (row.state !== "left" && row.state !== "banned" && row.state !== "removed") {
    const undone = await unsubscribeFromFederatedGroup(row.subscriptionId);
    if (!undone.ok && undone.status !== 404) return failure(undone.error);
  }
  await database.prepare("UPDATE remote_community_subscriptions SET state = 'left', updated_at = ? WHERE remote_community_id = ? AND profile_id = ?")
    .bind(nowIso(), remoteCommunityId, viewerProfileId).run();
  return { ok: true, left: true };
}

export type RemoteCommunityListItem = {
  id: string; name: string; host: string; slug: string; summary: string; state: string; address: string;
};

export async function listRemoteCommunities(database: D1Database, viewerProfileId: string): Promise<RemoteCommunityListItem[]> {
  const rows = await database.prepare(
    `SELECT c.id, c.name, c.host, c.slug, c.summary, s.state FROM remote_community_subscriptions s
     JOIN remote_communities c ON c.id = s.remote_community_id
     WHERE s.profile_id = ? AND s.state IN ('pending', 'accepted', 'rejected', 'removed', 'banned') ORDER BY s.created_at DESC LIMIT 100`,
  ).bind(viewerProfileId).all<Omit<RemoteCommunityListItem, "address">>();
  return rows.results.map((row) => ({ ...row, address: `${row.slug}@${row.host}` }));
}

export type RemoteCommunityItem = {
  id: string; objectType: "Page" | "Note"; title: string | null; body: string; inReplyToItemId: string | null; channelName: string | null;
  authorName: string; authorHandle: string; hostAuthored: boolean; publishedAt: string; own: boolean;
};

export type RemoteCommunityView = {
  community: { id: string; name: string; host: string; slug: string; summary: string; address: string; state: string; channels: Array<{ id: string; name: string }> };
  items: RemoteCommunityItem[];
};

/** 読めるのは、参加が受け入れられた（accepted）利用者だけ。出すのは Announce された発言だけ。 */
export async function readRemoteCommunity(
  database: D1Database,
  viewer: Pick<Profile, "id" | "handle">,
  remoteCommunityId: string,
): Promise<RemoteCommunityView | null> {
  const community = await database.prepare(
    `SELECT c.id, c.name, c.host, c.slug, c.summary, c.channels_json AS channelsJson, s.state FROM remote_communities c
     JOIN remote_community_subscriptions s ON s.remote_community_id = c.id WHERE c.id = ? AND s.profile_id = ?`,
  ).bind(remoteCommunityId, viewer.id).first<{ id: string; name: string; host: string; slug: string; summary: string; channelsJson: string; state: string }>();
  if (!community) return null;
  let channels: Array<{ id: string; name: string }> = [];
  try {
    const parsed = JSON.parse(community.channelsJson) as Array<{ id?: unknown; name?: unknown }>;
    channels = parsed.flatMap((entry) => typeof entry.id === "string" && typeof entry.name === "string" ? [{ id: entry.id, name: entry.name }] : []);
  } catch { /* 空として返す */ }
  const view: RemoteCommunityView = {
    community: {
      id: community.id, name: community.name, host: community.host, slug: community.slug, summary: community.summary,
      address: `${community.slug}@${community.host}`, state: community.state, channels,
    },
    items: [],
  };
  if (community.state !== "accepted") return view;
  const rows = await database.prepare(
    `SELECT i.id, i.object_type AS objectType, i.title, i.body, i.channel_name AS channelName, i.author_kind AS authorKind,
            i.author_actor_url AS authorActorUrl, i.author_handle AS authorHandle, i.author_name AS authorName, i.published_at AS publishedAt,
            (SELECT p.id FROM remote_community_items p WHERE p.object_url = i.in_reply_to_url AND p.remote_community_id = i.remote_community_id) AS parentId
     FROM remote_community_items i WHERE i.remote_community_id = ? AND i.state = 'visible' ORDER BY i.published_at DESC, i.id DESC LIMIT 300`,
  ).bind(remoteCommunityId).all<{
    id: string; objectType: "Page" | "Note"; title: string | null; body: string; channelName: string | null; authorKind: string;
    authorActorUrl: string | null; authorHandle: string | null; authorName: string | null; publishedAt: string; parentId: string | null;
  }>();
  const host = hubHost();
  const ownPath = `/users/${viewer.handle}`;
  view.items = rows.results.map((row) => {
    let own = false;
    if (row.authorKind === "actor" && row.authorActorUrl) {
      try {
        const url = new URL(row.authorActorUrl);
        own = url.host === host && url.pathname === ownPath;
      } catch { /* 不正な URL は他人扱い */ }
    }
    return {
      id: row.id, objectType: row.objectType, title: row.title, body: row.body, inReplyToItemId: row.parentId,
      channelName: row.channelName, authorName: row.authorName ?? row.authorHandle ?? "", authorHandle: row.authorHandle ?? "",
      hostAuthored: row.authorKind === "host", publishedAt: row.publishedAt, own,
    };
  });
  return view;
}

export async function postToRemoteCommunity(
  database: D1Database,
  viewer: Pick<Profile, "id" | "joinedAt">,
  remoteCommunityId: string,
  input: { body: string; title?: string; replyToItemId?: string | null; channelId?: string | null },
): Promise<RemoteCommunityResult<{ submitted: true }>> {
  const target = await database.prepare(
    `SELECT c.group_url AS groupUrl, s.state FROM remote_communities c JOIN remote_community_subscriptions s ON s.remote_community_id = c.id
     WHERE c.id = ? AND s.profile_id = ?`,
  ).bind(remoteCommunityId, viewer.id).first<{ groupUrl: string; state: string }>();
  if (!target || target.state !== "accepted") return failure("not_a_member", 409);
  let inReplyTo: string | null = null;
  if (input.replyToItemId) {
    const parent = await database.prepare(
      "SELECT object_url AS objectUrl FROM remote_community_items WHERE id = ? AND remote_community_id = ? AND state = 'visible'",
    ).bind(input.replyToItemId, remoteCommunityId).first<{ objectUrl: string }>();
    if (!parent) return failure("not_a_member", 404);
    inReplyTo = parent.objectUrl;
  }
  await consumeD1PostQuota(database, viewer, "thread_reply");
  const sent = await postToFederatedGroup({
    profileId: viewer.id,
    groupUrl: target.groupUrl,
    text: input.body,
    ...(input.title ? { title: input.title } : {}),
    inReplyTo,
    channelId: input.channelId ?? null,
  });
  if (!sent.ok) return failure(sent.error);
  return { ok: true, submitted: true };
}

/** 自分の書き込みを取り下げる。持ち主の Hub が Delete を受けて配り直す。 */
export async function deleteOwnRemoteCommunityPost(
  database: D1Database,
  viewer: Pick<Profile, "id" | "handle">,
  itemId: string,
): Promise<RemoteCommunityResult<{ deleted: true }>> {
  const item = await database.prepare(
    `SELECT i.object_url AS objectUrl, i.author_actor_url AS authorActorUrl FROM remote_community_items i
     JOIN remote_community_subscriptions s ON s.remote_community_id = i.remote_community_id AND s.profile_id = ?
     WHERE i.id = ? AND i.state = 'visible'`,
  ).bind(viewer.id, itemId).first<{ objectUrl: string; authorActorUrl: string | null }>();
  if (!item) return failure("not_a_member", 404);
  let own = false;
  try {
    const url = new URL(item.authorActorUrl ?? "");
    own = url.host === hubHost() && url.pathname === `/users/${viewer.handle}`;
  } catch { /* 他人扱い */ }
  if (!own) return failure("not_a_member", 403);
  const deleted = await deleteFederatedGroupPost(viewer.id, item.objectUrl);
  if (!deleted.ok && deleted.status !== 404) return failure(deleted.error);
  await database.prepare("UPDATE remote_community_items SET state = 'removed', updated_at = ? WHERE id = ?").bind(nowIso(), itemId).run();
  return { ok: true, deleted: true };
}

/* ---------------------------------------------------------------- 受信（Federation → 参加する側の Hub） */

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value : null;
}

async function remoteCommunityIdFor(database: D1Database, groupUrl: string | null): Promise<string | null> {
  if (!groupUrl) return null;
  const row = await database.prepare("SELECT id FROM remote_communities WHERE group_url = ?").bind(groupUrl).first<{ id: string }>();
  return row?.id ?? null;
}

async function setSubscriptionState(database: D1Database, subscriptionId: string | null, state: string) {
  if (!subscriptionId) return null;
  const row = await database.prepare(
    "SELECT remote_community_id AS remoteCommunityId, profile_id AS profileId FROM remote_community_subscriptions WHERE federation_subscription_id = ?",
  ).bind(subscriptionId).first<{ remoteCommunityId: string; profileId: string }>();
  if (!row) return null;
  await database.prepare(
    "UPDATE remote_community_subscriptions SET state = ?, updated_at = ? WHERE remote_community_id = ? AND profile_id = ? AND state <> 'left'",
  ).bind(state, nowIso(), row.remoteCommunityId, row.profileId).run();
  return row;
}

async function groupJoined(database: D1Database, event: GroupEvent) {
  const row = await setSubscriptionState(database, text(event.subscriptionId, 128), "accepted");
  const group = event.group as GroupInfo | undefined;
  if (!row || !group || typeof group.id !== "string") return;
  await upsertRemoteCommunity(database, {
    id: group.id, slug: String(group.slug), host: String(group.host), name: String(group.name ?? group.slug), summary: String(group.summary ?? ""), channels: group.channels,
  });
}

async function groupAnnounced(database: D1Database, event: GroupEvent) {
  const objectUrl = text(event.objectId, 2048);
  const body = text(event.content, 4000) ?? "";
  const title = text(event.title, 300);
  if (!objectUrl || (!body && !title)) return;
  const remoteCommunityId = await remoteCommunityIdFor(database, text(event.groupActorId, 2048));
  if (!remoteCommunityId) return;
  // 参加が受け入れられている利用者が1人もいないコミュニティの発言は、取り込まない。
  const joined = await database.prepare("SELECT 1 AS x FROM remote_community_subscriptions WHERE remote_community_id = ? AND state = 'accepted' LIMIT 1")
    .bind(remoteCommunityId).first();
  if (!joined) return;
  const author = event.author as { id?: unknown; handle?: unknown; host?: unknown; displayName?: unknown } | null | undefined;
  const hostAuthored = !author || typeof author.id !== "string";
  const communityHost = (await database.prepare("SELECT host FROM remote_communities WHERE id = ?").bind(remoteCommunityId).first<{ host: string }>())?.host ?? "";
  const authorHandle = hostAuthored
    ? (text(event.authorHandle, 80) ? `${event.authorHandle}@${communityHost}` : null)
    : `${typeof author?.handle === "string" ? author.handle : "user"}@${typeof author?.host === "string" ? author.host : ""}`;
  const authorName = hostAuthored
    ? text(event.authorName, 80)
    : (typeof author?.displayName === "string" && author.displayName ? author.displayName.slice(0, 80) : typeof author?.handle === "string" ? author.handle : null);
  const published = typeof event.published === "string" && Number.isFinite(Date.parse(event.published))
    ? new Date(Math.min(Date.parse(event.published), Date.now())).toISOString() : nowIso();
  const now = nowIso();
  await database.prepare(
    `INSERT OR IGNORE INTO remote_community_items
       (id, remote_community_id, object_url, object_type, title, body, in_reply_to_url, channel_name, author_kind, author_actor_url,
        author_handle, author_name, published_at, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
  ).bind(
    crypto.randomUUID(), remoteCommunityId, objectUrl, event.objectType === "Page" ? "Page" : "Note", title, body,
    text(event.inReplyTo, 2048), text(event.channelName, 50), hostAuthored ? "host" : "actor",
    hostAuthored ? null : String(author?.id), authorHandle, authorName, published, now, now,
  ).run();
}

async function groupPostUpdated(database: D1Database, event: GroupEvent) {
  const objectUrl = text(event.objectId, 2048);
  const remoteCommunityId = await remoteCommunityIdFor(database, text(event.groupActorId, 2048));
  const body = text(event.content, 4000) ?? "";
  const title = text(event.title, 300);
  if (!objectUrl || !remoteCommunityId || (!body && !title)) return;
  await database.prepare("UPDATE remote_community_items SET title = ?, body = ?, updated_at = ? WHERE object_url = ? AND remote_community_id = ?")
    .bind(title, body, nowIso(), objectUrl, remoteCommunityId).run();
}

async function groupPostDeleted(database: D1Database, event: GroupEvent) {
  const objectUrl = text(event.objectId, 2048);
  const remoteCommunityId = await remoteCommunityIdFor(database, text(event.groupActorId, 2048));
  if (!objectUrl || !remoteCommunityId) return;
  // その Group が配った発言だけを消す（別の Group の同じ URL には効かない）。
  await database.prepare("UPDATE remote_community_items SET state = 'removed', updated_at = ? WHERE object_url = ? AND remote_community_id = ?")
    .bind(nowIso(), objectUrl, remoteCommunityId).run();
}

export async function applyGroupMemberEvent(database: D1Database, event: GroupEvent): Promise<void> {
  switch (event.kind) {
    case "group_joined": return groupJoined(database, event);
    case "group_join_rejected": await setSubscriptionState(database, text(event.subscriptionId, 128), "rejected"); return;
    case "group_removed": await setSubscriptionState(database, text(event.subscriptionId, 128), event.ban === true ? "banned" : "removed"); return;
    case "group_announced": return groupAnnounced(database, event);
    case "group_post_updated": return groupPostUpdated(database, event);
    case "group_post_deleted": return groupPostDeleted(database, event);
    default: return;
  }
}
