import type { D1Database } from "@cloudflare/workers-types";

import type { AccessGateTargetType } from "@/lib/access-gates/types";

/*
 * Exits of gated content (docs/hub-token-gates/DESIGN.md lane D).
 *
 * Search, feeds, notifications, OGP, MCP, Hubpedia evidence, move bundles and
 * federation never show a gated body to anybody, even a viewer who passes the
 * gate. So these exits make no gate judgement and never touch RPC: a gate
 * attached to the target is enough to exclude the body. The per-viewer
 * decision belongs to redactGated (gated-content.ts, lane C) on the read paths.
 */

const ID_CHUNK = 80;

const LITERAL_TARGET_TYPES: ReadonlySet<string> = new Set(["post", "article", "video", "thread", "channel"]);

/**
 * SQL fragment: true when no gate is attached to the target. `idExpression` is a
 * trusted column expression such as `p.id`; `targetType` is validated, never bound from input.
 */
export function notGatedSql(targetType: AccessGateTargetType, idExpression: string): string {
  if (!LITERAL_TARGET_TYPES.has(targetType) || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(idExpression)) {
    throw new Error("invalid gate exclusion target");
  }
  return `NOT EXISTS (SELECT 1 FROM content_access_gates cag_exit WHERE cag_exit.target_type = '${targetType}' AND cag_exit.target_id = ${idExpression})`;
}

/** The ids (out of `ids`) that have a gate attached. One batched lookup per 80 ids. */
export async function gatedTargetIds(
  database: D1Database,
  targetType: AccessGateTargetType,
  ids: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  const gated = new Set<string>();
  for (let index = 0; index < unique.length; index += ID_CHUNK) {
    const chunk = unique.slice(index, index + ID_CHUNK);
    const result = await database
      .prepare(
        `SELECT target_id FROM content_access_gates WHERE target_type = ? AND target_id IN (${chunk.map(() => "?").join(", ")})`,
      )
      .bind(targetType, ...chunk)
      .all<{ target_id: string }>();
    for (const row of result.results ?? []) gated.add(row.target_id);
  }
  return gated;
}

export async function isTargetGated(database: D1Database, targetType: AccessGateTargetType, id: string): Promise<boolean> {
  return (await gatedTargetIds(database, targetType, [id])).has(id);
}

/** Drop gated items from a list (search, MCP, feeds that cannot show a locked card). */
export async function omitGated<T>(
  database: D1Database,
  targetType: AccessGateTargetType,
  items: readonly T[],
  idOf: (item: T) => string,
): Promise<T[]> {
  if (items.length === 0) return [];
  const gated = await gatedTargetIds(database, targetType, items.map(idOf));
  return gated.size === 0 ? [...items] : items.filter((item) => !gated.has(idOf(item)));
}

/* ---- notifications ---- */

export const GATED_NOTIFICATION_TEXT = "鍵付きのコンテンツに新しい動きがあります。";

export type NotificationTarget = { targetType: string; targetId: string };

/**
 * Keys ("type:id") of notification targets that sit under a gate. Resolves the
 * gate holder for each target type: a thread post and a community message
 * inherit the gate of their thread and channel.
 */
export async function gatedNotificationTargetKeys(
  database: D1Database,
  targets: readonly NotificationTarget[],
): Promise<Set<string>> {
  const keys = new Set<string>();
  const byType = (type: string) => [...new Set(targets.filter((t) => t.targetType === type).map((t) => t.targetId))];

  const postIds = byType("social_post");
  for (const id of await gatedTargetIds(database, "post", postIds)) keys.add(`social_post:${id}`);
  const videoIds = byType("external_video").concat(byType("video"));
  for (const id of await gatedTargetIds(database, "video", videoIds)) {
    keys.add(`external_video:${id}`);
    keys.add(`video:${id}`);
  }
  const articleIds = byType("article");
  for (const id of await gatedTargetIds(database, "article", articleIds)) keys.add(`article:${id}`);

  const threadIds = byType("thread");
  for (const id of await gatedTargetIds(database, "thread", threadIds)) keys.add(`thread:${id}`);

  const threadPostIds = byType("thread_post");
  if (threadPostIds.length) {
    const rows = await database
      .prepare(`SELECT id, thread_id FROM thread_posts WHERE id IN (${threadPostIds.map(() => "?").join(", ")})`)
      .bind(...threadPostIds)
      .all<{ id: string; thread_id: string }>();
    const threadOf = new Map((rows.results ?? []).map((row) => [row.id, row.thread_id]));
    const gatedThreads = await gatedTargetIds(database, "thread", [...threadOf.values()]);
    for (const [postId, threadId] of threadOf) if (gatedThreads.has(threadId)) keys.add(`thread_post:${postId}`);
  }

  const messageIds = byType("community_message");
  if (messageIds.length) {
    const rows = await database
      .prepare(`SELECT id, channel_id FROM community_channel_messages WHERE id IN (${messageIds.map(() => "?").join(", ")})`)
      .bind(...messageIds)
      .all<{ id: string; channel_id: string }>();
    const channelOf = new Map((rows.results ?? []).map((row) => [row.id, row.channel_id]));
    const gatedChannels = await gatedTargetIds(database, "channel", [...channelOf.values()]);
    for (const [messageId, channelId] of channelOf) if (gatedChannels.has(channelId)) keys.add(`community_message:${messageId}`);
  }
  return keys;
}

/** Replace the text of notifications about gated content with a generic line. Quotes never leave. */
export async function redactGatedNotifications<T extends { targetType: string; targetId: string; text: string }>(
  database: D1Database,
  notifications: readonly T[],
): Promise<T[]> {
  if (notifications.length === 0) return [];
  const keys = await gatedNotificationTargetKeys(database, notifications);
  if (keys.size === 0) return [...notifications];
  return notifications.map((n) => (keys.has(`${n.targetType}:${n.targetId}`) ? { ...n, text: GATED_NOTIFICATION_TEXT } : n));
}

/** Write-side twin of redactGatedNotifications for a single new notification. */
export async function notificationTextFor(
  database: D1Database,
  target: NotificationTarget,
  text: string,
): Promise<string> {
  try {
    const keys = await gatedNotificationTargetKeys(database, [target]);
    return keys.has(`${target.targetType}:${target.targetId}`) ? GATED_NOTIFICATION_TEXT : text;
  } catch {
    return GATED_NOTIFICATION_TEXT; // cannot check the gate: fail closed, never store the quote
  }
}

/* ---- Hubpedia evidence ---- */

/** True when the Hub item (a Hubpedia evidence kind) sits under a gate, directly or through its thread or channel. */
export async function isHubItemGated(database: D1Database, kind: string, id: string): Promise<boolean> {
  switch (kind) {
    case "post": return isTargetGated(database, "post", id);
    case "thread": return isTargetGated(database, "thread", id);
    case "article": return isTargetGated(database, "article", id);
    case "video": return isTargetGated(database, "video", id);
    case "thread_post":
      return (await gatedNotificationTargetKeys(database, [{ targetType: "thread_post", targetId: id }])).has(`thread_post:${id}`);
    case "channel_message":
      return (await gatedNotificationTargetKeys(database, [{ targetType: "community_message", targetId: id }])).has(`community_message:${id}`);
    default: return false;
  }
}

/* ---- OGP ---- */

/** A description for page metadata: the real one only when the target has no gate. */
export async function metadataDescription(
  database: D1Database | null | undefined,
  targetType: AccessGateTargetType,
  id: string,
  description: string | undefined | null,
): Promise<string | undefined> {
  if (!description) return undefined;
  if (!database) return undefined; // cannot check: fail closed
  try {
    return (await isTargetGated(database, targetType, id)) ? undefined : description;
  } catch {
    return undefined; // fail closed
  }
}

/* ---- federation ---- */

export type GateFederationDeps = {
  /** Sends ActivityPub Delete for a post (federation-gateway deleteFederatedPost). */
  deleteFederatedPost: (hubPostId: string) => Promise<void>;
  /** Sends ActivityPub Create for a post (federation-gateway publishFederatedPost). */
  publishFederatedPost: (input: {
    profileId: string;
    hubPostId: string;
    text: string;
    inReplyToHubPostId?: string | null;
    attachments?: Array<{ url: string; mediaType: string; name?: string }>;
  }) => Promise<void>;
  /** Attachment URLs for the post, if any. */
  imageAttachments?: (postId: string) => Promise<Array<{ url: string; mediaType: string; name?: string }>>;
};

async function defaultDeps(): Promise<GateFederationDeps> {
  const gateway = await import("@/lib/server/federation-gateway");
  return { deleteFederatedPost: gateway.deleteFederatedPost, publishFederatedPost: gateway.publishFederatedPost };
}

/**
 * Called after a gate is attached. Only local posts federate, so only a `post`
 * target is affected: a Delete goes out (404/409 from the gateway is fine when
 * the post never left this Hub). Never throws; the gate has already been saved.
 */
export async function onAccessGateAttached(
  _database: D1Database,
  target: { targetType: string; targetId: string },
  deps?: GateFederationDeps,
): Promise<void> {
  if (target.targetType !== "post") return;
  try {
    const d = deps ?? (await defaultDeps());
    await d.deleteFederatedPost(target.targetId);
  } catch {
    console.warn(JSON.stringify({ event: "gate_federation_delete_failed" }));
  }
}

/**
 * Called after a gate is removed. The post becomes public, so only now does it
 * federate: a Create goes out when the post is a public, unmoderated, local
 * post with an accountable author. Never throws.
 */
export async function onAccessGateDetached(
  database: D1Database,
  target: { targetType: string; targetId: string },
  deps?: GateFederationDeps,
): Promise<void> {
  if (target.targetType !== "post") return;
  try {
    const post = await database
      .prepare(
        `SELECT id, author_profile_id AS authorProfileId, body, reply_to_post_id AS replyToPostId
         FROM social_posts
         WHERE id = ? AND audience = 'public' AND moderated_at IS NULL
           AND origin = 'local' AND author_profile_id IS NOT NULL AND length(body) > 0`,
      )
      .bind(target.targetId)
      .first<{ id: string; authorProfileId: string; body: string; replyToPostId: string | null }>();
    if (!post) return;
    // A different gate may still be on it (attach replaces, detach removes the only row), so re-check.
    if (await isTargetGated(database, "post", post.id)) return;
    const d = deps ?? (await defaultDeps());
    const attachments = d.imageAttachments ? await d.imageAttachments(post.id) : undefined;
    await d.publishFederatedPost({
      profileId: post.authorProfileId,
      hubPostId: post.id,
      text: post.body,
      inReplyToHubPostId: post.replyToPostId,
      ...(attachments?.length ? { attachments } : {}),
    });
  } catch {
    console.warn(JSON.stringify({ event: "gate_federation_create_failed" }));
  }
}

/** Gate guard for outbound federation of a post that is created or edited. */
export async function mayFederatePost(database: D1Database, postId: string): Promise<boolean> {
  try {
    return !(await isTargetGated(database, "post", postId));
  } catch {
    return false; // fail closed
  }
}
