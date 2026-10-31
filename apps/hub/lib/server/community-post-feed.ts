import type { D1Database } from "@cloudflare/workers-types";

export type CommunityPostFeedItem = {
  id: string;
  channelId: string;
  channelName: string;
  displayName: string;
  handle: string | null;
  body: string;
  createdAt: string;
  kind: "chat" | "guide" | "question" | "party";
  pinned: boolean;
  workflowStatus: "open" | "resolved" | "closed";
  replyCount: number;
  likeCount: number;
};

type CommunityRow = { id: string; visibility: "public" | "approval" | "private" };
type PostRow = {
  id: string;
  channel_id: string;
  channel_name: string;
  display_name: string;
  handle: string | null;
  body: string;
  created_at: string;
  kind: CommunityPostFeedItem["kind"];
  pinned_at: string | null;
  workflow_status: CommunityPostFeedItem["workflowStatus"];
  reply_count: number;
  reaction_count: number;
};

type Cursor = { createdAt: string; id: string };

function toBase64Url(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

export function encodeCommunityPostCursor(cursor: Cursor) {
  return toBase64Url(`${cursor.createdAt}\n${cursor.id}`);
}

export function decodeCommunityPostCursor(value: string | null): Cursor | null {
  if (!value || value.length > 300) return null;
  try {
    const [createdAt, id, ...rest] = fromBase64Url(value).split("\n");
    if (rest.length || !createdAt || !id || !Number.isFinite(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function getCommunityPostFeed(
  database: D1Database,
  input: { communityId: string; limit: number; cursor: Cursor | null; viewerProfileId: string | null },
) {
  const community = await database
    .prepare("SELECT id, visibility FROM communities WHERE id = ? LIMIT 1")
    .bind(input.communityId)
    .first<CommunityRow>();
  if (!community) return null;
  if (community.visibility === "private") {
    if (!input.viewerProfileId) return null;
    const membership = await database.prepare(`SELECT 1 AS allowed
      FROM community_memberships
      WHERE community_id = ? AND profile_id = ? AND status = 'active'
      LIMIT 1`).bind(input.communityId, input.viewerProfileId).first<{ allowed: number }>();
    if (!membership?.allowed) return null;
  }

  const limit = Math.min(Math.max(Math.floor(input.limit), 1), 50);
  const cursorClause = input.cursor
    ? "AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))"
    : "";
  const statement = database.prepare(`SELECT
      m.id, m.channel_id, c.name AS channel_name, p.display_name, p.handle,
      m.body, m.created_at, m.kind, m.pinned_at, m.workflow_status,
      (SELECT count(*) FROM community_channel_messages reply WHERE reply.reply_to_message_id = m.id) AS reply_count,
      (SELECT count(*) FROM community_channel_reactions reaction WHERE reaction.message_id = m.id) AS reaction_count
    FROM community_channel_messages m
    JOIN community_channels c ON c.id = m.channel_id
    JOIN profiles p ON p.id = m.author_profile_id
    WHERE c.community_id = ? AND c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM content_access_gates cag WHERE cag.target_type = 'channel' AND cag.target_id = c.id) ${cursorClause}
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`);
  const bound = input.cursor
    ? statement.bind(input.communityId, input.cursor.createdAt, input.cursor.createdAt, input.cursor.id, limit + 1)
    : statement.bind(input.communityId, limit + 1);
  const result = await bound.all<PostRow>();
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const posts: CommunityPostFeedItem[] = rows.map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    displayName: row.display_name,
    handle: row.handle,
    body: row.body,
    createdAt: row.created_at,
    kind: row.kind,
    pinned: Boolean(row.pinned_at),
    workflowStatus: row.workflow_status,
    replyCount: Number(row.reply_count) || 0,
    likeCount: Number(row.reaction_count) || 0,
  }));
  const last = rows.at(-1);
  return {
    communityId: input.communityId,
    posts,
    nextCursor: hasMore && last
      ? encodeCommunityPostCursor({ createdAt: last.created_at, id: last.id })
      : null,
  };
}
