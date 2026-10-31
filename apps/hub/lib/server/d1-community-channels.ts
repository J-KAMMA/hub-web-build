import { communityMessageRequestIdentity } from "./community-message-request";
import type { D1Database } from "@cloudflare/workers-types";
import { extractSocialMentionHandles } from "@/lib/social-mentions";

import type {
  CommunityChannel,
  CommunityChannelMessage,
  CommunityChannelReaction,
  Profile,
} from "@/lib/domain";
import { getThreadPostQuota } from "@/lib/thread-abuse-controls";
import { communityMessageQuota } from "./community-message-quota";
import { evaluateChannelGate, type ChannelGateVerifier } from "./community-channel-gate";
import { createD1HubNotification } from "@/lib/server/d1-notification-events";

type ChannelRow = {
  id: string;
  community_id: string;
  name: string;
  description: string;
  position: number;
  created_at: string;
};

type MessageRow = {
  id: string;
  channel_id: string;
  author_profile_id: string;
  bot_id: string | null;
  bot_name: string | null;
  body: string;
  created_at: string;
  reply_to_message_id: string | null;
  edited_at: string | null;
  kind: "chat" | "guide" | "question" | "party";
  pinned_at: string | null;
  pinned_by_profile_id: string | null;
  workflow_status: "open" | "resolved" | "closed";
};

type MembershipRow = {
  role: "owner" | "moderator" | "member";
  status: "active" | "muted" | "banned";
};

export class CommunityPermissionError extends Error {
  constructor(message = "この操作を行う権限がありません。") {
    super(message);
    this.name = "CommunityPermissionError";
  }
}

function mapChannel(row: ChannelRow): CommunityChannel {
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    description: row.description,
    position: Number(row.position),
    createdAt: row.created_at,
  };
}

function mapMessage(row: MessageRow): CommunityChannelMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorProfileId: row.author_profile_id,
    botId: row.bot_id,
    botName: row.bot_name,
    body: row.body,
    createdAt: row.created_at,
    replyToMessageId: row.reply_to_message_id,
    editedAt: row.edited_at,
    kind: row.kind,
    pinnedAt: row.pinned_at,
    pinnedByProfileId: row.pinned_by_profile_id,
    workflowStatus: row.workflow_status,
  };
}

async function getMembership(
  database: D1Database,
  communityId: string,
  profileId: string,
) {
  return database
    .prepare(
      `SELECT role, status FROM community_memberships
       WHERE community_id = ? AND profile_id = ? LIMIT 1`,
    )
    .bind(communityId, profileId)
    .first<MembershipRow>();
}

async function requireManager(
  database: D1Database,
  communityId: string,
  profileId: string,
) {
  const community = await database.prepare(
    `SELECT lifecycle_status AS lifecycleStatus
     FROM communities WHERE id = ? LIMIT 1`,
  ).bind(communityId).first<{ lifecycleStatus: "active" | "closed" }>();
  if (!community || community.lifecycleStatus !== "active") {
    throw new CommunityPermissionError(
      "閉鎖されたコミュニティは変更できません。",
    );
  }
  const membership = await getMembership(database, communityId, profileId);
  if (
    !membership ||
    membership.status !== "active" ||
    (membership.role !== "owner" && membership.role !== "moderator")
  ) {
    throw new CommunityPermissionError();
  }
}

export async function requireActiveMember(
  database: D1Database,
  communityId: string,
  profileId: string,
  channelId?: string,
  gateVerifier?: ChannelGateVerifier,
) {
  const community = await database.prepare("SELECT lifecycle_status FROM communities WHERE id = ? LIMIT 1")
    .bind(communityId).first<{ lifecycle_status: "active" | "closed" }>();
  if (!community || community.lifecycle_status !== "active") {
    throw new CommunityPermissionError("このコミュニティは閉鎖されています。");
  }
  const suspended = () => database.prepare("SELECT status FROM profile_moderation_status WHERE profile_id = ? AND status = 'suspended' LIMIT 1")
    .bind(profileId).first();
  if (await suspended()) throw new CommunityPermissionError("利用停止中は投稿できません。");
  let membership = await getMembership(database, communityId, profileId);
  if (membership?.status === "muted") {
    const now = new Date().toISOString();
    // A timeout must still be the current restriction, including tied timestamps.
    const currentTimeout = `a.community_id = ? AND a.target_profile_id = ?
      AND a.action = 'timeout' AND a.expires_at <= ?
      AND NOT EXISTS (SELECT 1 FROM community_member_actions newer
        WHERE newer.community_id = a.community_id AND newer.target_profile_id = a.target_profile_id
        AND newer.id <> a.id AND newer.created_at >= a.created_at)
      AND NOT EXISTS (SELECT 1 FROM community_audit_log audit
        WHERE audit.community_id = a.community_id AND audit.target_profile_id = a.target_profile_id
        AND audit.created_at >= a.created_at AND (
          audit.action IN ('member_mute', 'member_unmute', 'member_ban', 'member_timeout_expired', 'resolve_appeal')
          OR (audit.action IN ('member_promote', 'member_demote') AND CASE
            WHEN NOT json_valid(audit.detail) THEN 1
            WHEN json_type(audit.detail, '$.before.status') IS NOT 'text'
              OR json_type(audit.detail, '$.after.status') IS NOT 'text' THEN 1
            WHEN json_extract(audit.detail, '$.before.status') NOT IN ('active', 'muted', 'banned')
              OR json_extract(audit.detail, '$.after.status') NOT IN ('active', 'muted', 'banned') THEN 1
            ELSE json_extract(audit.detail, '$.before.status') <> json_extract(audit.detail, '$.after.status') END)
        ))`;
    const timeout = await database.prepare(`SELECT a.id FROM community_member_actions a WHERE ${currentTimeout} LIMIT 1`)
      .bind(communityId, profileId, now).first<{ id: string }>();
    if (timeout) {
      const operationId = crypto.randomUUID();
      const detail = JSON.stringify({ targetId: profileId, sourceTimeoutId: timeout.id,
        before: membership, after: { ...membership, status: "active" } });
      await database.batch([
        database.prepare(`UPDATE community_memberships SET status = 'active'
          WHERE community_id = ? AND profile_id = ? AND status = 'muted' AND role = ?
          AND EXISTS (SELECT 1 FROM communities WHERE communities.id = community_memberships.community_id AND lifecycle_status = 'active')
          AND NOT EXISTS (SELECT 1 FROM profile_moderation_status WHERE profile_id = community_memberships.profile_id AND status = 'suspended')
          AND EXISTS (SELECT 1 FROM community_member_actions a WHERE a.id = ? AND ${currentTimeout})`)
          .bind(communityId, profileId, membership.role, timeout.id, communityId, profileId, now),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, target_profile_id, action, detail, created_at)
          SELECT ?, ?, ?, ?, 'member_timeout_expired', ?, ? WHERE changes() = 1`)
          .bind(operationId, communityId, profileId, profileId, detail, now),
        // Ignored audit inserts must roll back an otherwise successful expiry.
        database.prepare(`SELECT CASE WHEN (
          NOT EXISTS (SELECT 1 FROM community_audit_log WHERE id = ?)
          AND NOT EXISTS (SELECT 1 FROM community_memberships WHERE community_id = ? AND profile_id = ? AND status = 'active')
        ) OR EXISTS (
          SELECT 1 FROM community_audit_log audit JOIN community_memberships membership
            ON membership.community_id = audit.community_id AND membership.profile_id = audit.target_profile_id
          WHERE audit.id = ? AND audit.community_id = ? AND audit.actor_profile_id = ? AND audit.target_profile_id = ?
            AND audit.action = 'member_timeout_expired' AND audit.detail = ? AND audit.created_at = ?
            AND membership.role = ? AND membership.status = 'active'
        ) THEN 1 ELSE json('') END`)
          .bind(operationId, communityId, profileId, operationId, communityId, profileId, profileId, detail, now, membership.role),
      ]);
      const currentCommunity = await database.prepare("SELECT lifecycle_status FROM communities WHERE id = ? LIMIT 1")
        .bind(communityId).first<{ lifecycle_status: string }>();
      if (currentCommunity?.lifecycle_status !== "active" || await suspended()) throw new CommunityPermissionError();
      membership = await getMembership(database, communityId, profileId);
    }
  }
  if (!membership) {
    throw new CommunityPermissionError(
      "投稿するにはコミュニティへの参加が必要です。",
    );
  }
  if (membership.status === "muted") {
    throw new CommunityPermissionError("ミュート中は投稿できません。");
  }
  if (membership.status !== "active") {
    throw new CommunityPermissionError("このコミュニティには投稿できません。");
  }
  if (channelId && membership.role === "member") {
    const permission = await database.prepare(`SELECT MIN(p.can_post) AS can_post
      FROM community_member_custom_roles mr
      JOIN community_channel_permissions p ON p.role_id = mr.role_id
      WHERE mr.community_id = ? AND mr.profile_id = ? AND p.channel_id = ?`)
      .bind(communityId, profileId, channelId).first<{ can_post: number | null }>();
    if (permission?.can_post === 0) {
      throw new CommunityPermissionError("このチャンネルへ投稿する権限がありません。");
    }
    // Token gate (access_gates via content_access_gates). The balance is read on
    // chain by the verifier (10-minute cache); token_balances is never consulted.
    const gateState = await evaluateChannelGate(database, { communityId, channelId, profileId }, gateVerifier);
    if (gateState.gated && gateState.verdict !== "allowed") {
      throw new CommunityPermissionError(gateState.verdict === "unavailable"
        ? "保有条件を確認できませんでした。時間をおいてもう一度お試しください。"
        : "このチャンネルの保有条件を満たしていません。");
    }
  }
}

async function getChannel(
  database: D1Database,
  communityId: string,
  channelId: string,
) {
  const row = await database
    .prepare(
      `SELECT id, community_id, name, description, position, created_at
       FROM community_channels WHERE id = ? AND community_id = ? LIMIT 1`,
    )
    .bind(channelId, communityId)
    .first<ChannelRow>();
  return row ? mapChannel(row) : undefined;
}

export async function listD1CommunityChannels(
  database: D1Database,
  communityId: string,
  viewerProfileId: string | null = null,
) {
  const viewerId = viewerProfileId ?? "";
  const result = await database
    .prepare(
      `SELECT channel.id, channel.community_id, channel.name,
       channel.description, channel.position, channel.created_at
       FROM community_channels channel
       JOIN communities community ON community.id = channel.community_id
       WHERE channel.community_id = ?
         AND channel.archived_at IS NULL
         AND community.lifecycle_status = 'active'
         AND (
           community.visibility = 'public'
           OR EXISTS (
             SELECT 1 FROM community_memberships membership
             WHERE membership.community_id = channel.community_id
               AND membership.profile_id = ?
               AND membership.status <> 'banned'
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM community_member_custom_roles member_role
           JOIN community_channel_permissions permission
             ON permission.role_id = member_role.role_id
           WHERE member_role.community_id = channel.community_id
             AND member_role.profile_id = ?
             AND permission.channel_id = channel.id
           GROUP BY permission.channel_id
           HAVING MIN(permission.can_view) = 0
         )
       ORDER BY channel.position, channel.created_at, channel.id`,
    )
    .bind(communityId, viewerId, viewerId)
    .all<ChannelRow>();
  return (result.results ?? []).map(mapChannel);
}

export async function createD1CommunityChannel(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: { communityId: string; name: string; description: string },
) {
  await requireManager(database, input.communityId, viewer.id);
  const positionRow = await database
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM community_channels WHERE community_id = ?",
    )
    .bind(input.communityId)
    .first<{ position: number }>();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO community_channels
       (id, community_id, name, description, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.communityId,
      input.name,
      input.description,
      Number(positionRow?.position ?? 0),
      now,
    )
    .run();
  const channel = await getChannel(database, input.communityId, id);
  if (!channel) throw new Error("チャンネルを保存できませんでした。");
  return channel;
}

export async function updateD1CommunityChannel(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: {
    communityId: string;
    channelId: string;
    name?: string;
    description?: string;
    direction?: "up" | "down";
  },
) {
  await requireManager(database, input.communityId, viewer.id);
  const channel = await getChannel(
    database,
    input.communityId,
    input.channelId,
  );
  if (!channel) throw new Error("チャンネルが見つかりません。");

  if (input.name !== undefined || input.description !== undefined) {
    await database
      .prepare(
        `UPDATE community_channels SET name = ?, description = ?
         WHERE id = ? AND community_id = ?`,
      )
      .bind(
        input.name ?? channel.name,
        input.description ?? channel.description,
        input.channelId,
        input.communityId,
      )
      .run();
  }

  if (input.direction) {
    const channels = await listD1CommunityChannels(
      database,
      input.communityId,
      viewer.id,
    );
    const index = channels.findIndex(
      (candidate) => candidate.id === input.channelId,
    );
    const swapIndex = input.direction === "up" ? index - 1 : index + 1;
    const swap = channels[swapIndex];
    if (index >= 0 && swap) {
      await database.batch([
        database
          .prepare("UPDATE community_channels SET position = ? WHERE id = ?")
          .bind(swap.position, channel.id),
        database
          .prepare("UPDATE community_channels SET position = ? WHERE id = ?")
          .bind(channel.position, swap.id),
      ]);
    }
  }

  const updated = await getChannel(
    database,
    input.communityId,
    input.channelId,
  );
  if (!updated) throw new Error("チャンネルを更新できませんでした。");
  return updated;
}

export async function deleteD1CommunityChannel(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: {
    communityId: string;
    channelId: string;
    operationId: string;
    note?: string;
  },
) {
  await requireManager(database, input.communityId, viewer.id);
  const existing = await database.prepare(`SELECT id, action, created_at AS createdAt
    FROM community_audit_log WHERE id = ? AND community_id = ? LIMIT 1`)
    .bind(input.operationId, input.communityId)
    .first<{ id: string; action: string; createdAt: string }>();
  if (existing) {
    if (existing.action !== "channel_deleted") {
      throw new Error("操作IDが別の操作で使用されています。");
    }
    return {
      deleted: true as const,
      channelId: input.channelId,
      receipt: {
        auditId: existing.id,
        action: existing.action,
        targetId: input.channelId,
        confirmedAt: existing.createdAt,
        replayed: true,
      },
    };
  }
  const channels = await listD1CommunityChannels(
    database,
    input.communityId,
    viewer.id,
  );
  const channel = channels.find((entry) => entry.id === input.channelId);
  if (!channel) {
    throw new Error("チャンネルが見つかりません。");
  }
  if (channels.length <= 1) {
    throw new Error("最後のチャンネルは削除できません。");
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("DELETE FROM community_channels WHERE id = ? AND community_id = ?")
      .bind(input.channelId, input.communityId),
    database.prepare(`INSERT INTO community_audit_log
      (id, community_id, actor_profile_id, action, detail, created_at)
      VALUES (?, ?, ?, 'channel_deleted', ?, ?)`)
      .bind(input.operationId, input.communityId, viewer.id, JSON.stringify({
        note: input.note ?? "",
        targetId: input.channelId,
        targetLabel: `#${channel.name}`,
      }), now),
  ]);
  return {
    deleted: true as const,
    channelId: input.channelId,
    receipt: {
      auditId: input.operationId,
      action: "channel_deleted",
      targetId: input.channelId,
      confirmedAt: now,
      replayed: false,
    },
  };
}

/**
 * The single read-visibility rule for a channel's messages: the channel must belong to the community and be
 * visible to the viewer (public community or non-banned member, no role-level can_view denial), and a token
 * gate must pass. Throws when the channel is not visible; returns "gated" when a gate withholds the content.
 */
export async function resolveChannelReadAccess(
  database: D1Database,
  communityId: string,
  channelId: string,
  viewerProfileId: string | null = null,
  gateVerifier?: ChannelGateVerifier,
): Promise<"ok" | "gated"> {
  const viewerId = viewerProfileId ?? "";
  const visibleChannel = await database.prepare(`SELECT c.id
    FROM community_channels c
    JOIN communities community ON community.id = c.community_id
    WHERE c.id = ?
      AND c.community_id = ?
      AND (
        community.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM community_memberships membership
          WHERE membership.community_id = c.community_id
            AND membership.profile_id = ?
            AND membership.status <> 'banned'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM community_member_custom_roles member_role
        JOIN community_channel_permissions permission ON permission.role_id = member_role.role_id
        WHERE member_role.community_id = c.community_id
          AND member_role.profile_id = ?
          AND permission.channel_id = c.id
        GROUP BY permission.channel_id
        HAVING MIN(permission.can_view) = 0
      )
    LIMIT 1`)
    .bind(channelId, communityId, viewerId, viewerId)
    .first<{ id: string }>();
  if (!visibleChannel) {
    throw new Error("チャンネルが見つかりません。");
  }
  // Gated channel: the body is withheld server-side unless the viewer passes the gate.
  const gateState = await evaluateChannelGate(database, { communityId, channelId, profileId: viewerProfileId }, gateVerifier);
  if (gateState.gated && gateState.verdict !== "allowed") return "gated";
  return "ok";
}

export async function listD1CommunityChannelMessages(
  database: D1Database,
  communityId: string,
  channelId: string,
  viewerProfileId: string | null = null,
  messageId: string | null = null,
  gateVerifier?: ChannelGateVerifier,
) {
  const viewerId = viewerProfileId ?? "";
  if ((await resolveChannelReadAccess(database, communityId, channelId, viewerProfileId, gateVerifier)) === "gated") return [];
  const authorVisibilityScope = viewerProfileId
    ? `AND (
        m.author_profile_id IS NULL
        OR (
          NOT EXISTS (
            SELECT 1 FROM profile_moderation_status moderation
            WHERE moderation.profile_id = m.author_profile_id
              AND moderation.status = 'suspended'
          )
          AND NOT EXISTS (
            SELECT 1 FROM thread_user_controls outgoing_control
            WHERE outgoing_control.owner_profile_id = ?
              AND outgoing_control.target_profile_id = m.author_profile_id
              AND (outgoing_control.muted = 1 OR outgoing_control.blocked = 1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM thread_user_controls incoming_control
            WHERE incoming_control.owner_profile_id = m.author_profile_id
              AND incoming_control.target_profile_id = ?
              AND incoming_control.blocked = 1
          )
        )
      )`
    : `AND (
        m.author_profile_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM profile_moderation_status moderation
          WHERE moderation.profile_id = m.author_profile_id
            AND moderation.status = 'suspended'
        )
      )`;
  const result = await database
    .prepare(
      `SELECT m.id, m.channel_id, m.author_profile_id, m.body, m.created_at,
       m.reply_to_message_id, m.edited_at, m.kind, m.pinned_at,
       m.pinned_by_profile_id, m.workflow_status, m.bot_id, b.name AS bot_name
       FROM community_channel_messages m
       LEFT JOIN community_bots b ON b.id = m.bot_id
       WHERE m.channel_id = ?
       AND (? IS NULL OR m.id = ?)
       ${authorVisibilityScope}
       ORDER BY m.created_at, m.id LIMIT 500`,
    )
    .bind(...(viewerProfileId ? [channelId, messageId, messageId, viewerId, viewerId] : [channelId, messageId, messageId]))
    .all<MessageRow>();
  const messages = (result.results ?? []).map(mapMessage);
  const { attachImagesToPosts } = await import("@/lib/server/social-post-images");
  await attachImagesToPosts(database, messages);
  return messages;
}

export async function createD1CommunityChannelMessage(
  database: D1Database,
  viewer: Pick<Profile, "id" | "joinedAt">,
  input: {
    communityId: string;
    channelId: string;
    body: string;
    replyToMessageId?: string | null;
    kind: "chat" | "guide" | "question" | "party";
    imageIds?: string[];
    clientRequestId?: string;
  },
  gateVerifier?: ChannelGateVerifier,
) {
  await requireActiveMember(database, input.communityId, viewer.id, input.channelId, gateVerifier);
  const channel = await database.prepare(`SELECT id, archived_at AS archivedAt, slowmode_seconds AS slowmodeSeconds
    FROM community_channels WHERE id = ? AND community_id = ? LIMIT 1`).bind(input.channelId, input.communityId)
    .first<{ id: string; archivedAt: string | null; slowmodeSeconds: number }>();
  if (!channel) {
    throw new Error("チャンネルが見つかりません。");
  }
  const identity = input.clientRequestId ? await communityMessageRequestIdentity(viewer.id, input.clientRequestId, input) : null;
  type Operation = { request_fingerprint: string; profile_id: string; community_id: string; channel_id: string; created_at: string; completed_at: string | null; deleted_at: string | null };
  const readOperation = async () => {
    if (!identity) return null;
    const row = await database.prepare("SELECT * FROM community_message_operations WHERE message_id = ?").bind(identity.messageId).first<Operation>();
    if (row && (row.request_fingerprint !== identity.fingerprint || row.profile_id !== viewer.id || row.community_id !== input.communityId || row.channel_id !== input.channelId)) throw new Error("投稿操作IDが異なる内容に使用されています。");
    if (row?.deleted_at) throw new Error("この投稿は削除されています。");
    if(row){
      const saved=await database.prepare('SELECT author_profile_id actorId,body,kind,reply_to_message_id replyId,created_at createdAt FROM community_channel_messages WHERE id=? AND channel_id=?').bind(identity.messageId,input.channelId).first<{actorId:string;body:string;kind:string;replyId:string|null;createdAt:string}>();
      if(!saved||saved.actorId!==viewer.id||saved.body.trim()!==input.body.trim()||saved.kind!==input.kind||saved.replyId!==(input.replyToMessageId??null)||saved.createdAt!==row.created_at)throw new Error('保存済みの投稿内容を確認できませんでした。');
    }
    return row;
  };
  let operation = await readOperation();
  if(!operation&&channel.archivedAt)throw new Error("このチャンネルはアーカイブされています。");
  if (!operation && channel.slowmodeSeconds > 0) {
    const latest = await database.prepare(`SELECT created_at AS createdAt FROM community_channel_messages
      WHERE channel_id = ? AND author_profile_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(input.channelId, viewer.id).first<{ createdAt: string }>();
    if (latest && Date.now() - Date.parse(latest.createdAt) < channel.slowmodeSeconds * 1000) {
      throw new Error(`低速モード中です。${channel.slowmodeSeconds}秒空けて投稿してください。`);
    }
  }
  if (!operation && input.replyToMessageId) {
    const replyTarget = await database
      .prepare(
        "SELECT id FROM community_channel_messages WHERE id = ? AND channel_id = ? LIMIT 1",
      )
      .bind(input.replyToMessageId, input.channelId)
      .first<{ id: string }>();
    if (!replyTarget) throw new Error("返信先の投稿が見つかりません。");
  }
  const normalizedBody = input.body.normalize("NFKC").trim();
  if (!operation) {
  const recentDuplicate = await database.prepare(`SELECT count(*) AS total FROM community_channel_messages
    WHERE channel_id = ? AND author_profile_id = ? AND body = ? AND created_at >= ?`)
    .bind(input.channelId, viewer.id, normalizedBody, new Date(Date.now() - 10 * 60_000).toISOString()).first<{ total: number }>();
  if (Number(recentDuplicate?.total ?? 0) >= 2) throw new Error("同じ内容の連続投稿はできません。");
  const linkCount = (normalizedBody.match(/https?:\/\//giu) ?? []).length;
  if (linkCount > 5) throw new Error("1件の投稿に含められるリンクは5件までです。");
  }
  const imageIds = input.imageIds ?? [];
  if (imageIds.length > 4 || new Set(imageIds).size !== imageIds.length) throw new Error("画像は1投稿4枚までです。");
  const { publishImages, validatePendingImages } = await import("@/lib/server/social-post-images");
  const id = identity?.messageId ?? crypto.randomUUID();
  let now = operation?.created_at ?? new Date().toISOString();
  if (!operation) {
  await validatePendingImages(database, viewer.id, imageIds);
  now=new Date().toISOString();
  const policy=`EXISTS(SELECT 1 FROM community_channels channel JOIN communities community ON community.id=channel.community_id JOIN community_memberships member ON member.community_id=community.id JOIN profiles actor ON actor.id=member.profile_id
    WHERE channel.id=? AND channel.community_id=? AND community.lifecycle_status='active' AND channel.archived_at IS NULL AND channel.slowmode_seconds IN (0,5,10,30,60,300,600,3600)
    AND actor.id=? AND member.status='active' AND member.role IN ('owner','moderator','member') AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=actor.id AND moderation.status='suspended')
    AND (member.role IN ('owner','moderator') OR (NOT EXISTS(SELECT 1 FROM community_member_custom_roles mr JOIN community_channel_permissions permission ON permission.role_id=mr.role_id WHERE mr.community_id=community.id AND mr.profile_id=actor.id AND permission.channel_id=channel.id AND permission.can_post=0)
      AND NOT EXISTS(SELECT 1 FROM content_access_gates cag WHERE cag.target_type='channel' AND cag.target_id=channel.id AND NOT EXISTS(SELECT 1 FROM access_gates gate JOIN access_gate_checks chk ON chk.gate_id=gate.id AND chk.gate_version=gate.version WHERE gate.id=cag.gate_id AND chk.profile_id=actor.id AND chk.allowed=1 AND chk.expires_at>?))))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM community_channel_messages reply WHERE reply.id=? AND reply.channel_id=channel.id))
    AND NOT EXISTS(SELECT 1 FROM community_channel_messages latest WHERE latest.id=(SELECT recent.id FROM community_channel_messages recent WHERE recent.channel_id=channel.id AND recent.author_profile_id=actor.id AND recent.id<>? ORDER BY recent.created_at DESC,recent.id DESC LIMIT 1)
      AND (julianday(latest.created_at) IS NULL OR julianday(latest.created_at)>julianday(?) OR julianday(latest.created_at,'+'||channel.slowmode_seconds||' seconds')>julianday(?))))`;
  const policyValues=[input.channelId,input.communityId,viewer.id,new Date().toISOString(),input.replyToMessageId??null,input.replyToMessageId??null,id,now,now];
  const insertMessage = database
    .prepare(
      `INSERT INTO community_channel_messages
       (id, channel_id, author_profile_id, body, created_at,
        reply_to_message_id, edited_at, kind, pinned_at,
        pinned_by_profile_id, workflow_status)
       SELECT ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'open' WHERE ${policy}`,
    )
    .bind(
      id,
      input.channelId,
      viewer.id,
      input.body,
      now,
      input.replyToMessageId ?? null,
      input.kind,
      ...policyValues,
    );
  const quotaTime=new Date(now),quota=communityMessageQuota(database,viewer,quotaTime),quotaLimit=getThreadPostQuota(viewer,'thread_reply',quotaTime);
  const window=new Date(Math.floor(quotaTime.getTime()/quotaLimit.windowMs)*quotaLimit.windowMs).toISOString();
  const expires=new Date(Date.parse(window)+quotaLimit.windowMs).toISOString();
  const consumed=`EXISTS(SELECT 1 FROM hub_rate_limit_buckets WHERE profile_id=? AND action='thread_reply' AND window_started_at=? AND request_count BETWEEN 1 AND ? AND expires_at=?)`;
  const consumedValues=[viewer.id,window,quotaLimit.limit,expires];
  const operationProof=identity?`AND EXISTS(SELECT 1 FROM community_message_operations WHERE message_id=? AND profile_id=? AND community_id=? AND channel_id=? AND request_fingerprint=? AND created_at=? AND deleted_at IS NULL)`:'';
  try {
    await database.batch([
      ...(identity?[database.prepare('INSERT INTO community_message_operations(message_id,profile_id,community_id,channel_id,request_fingerprint,created_at) VALUES(?,?,?,?,?,?)').bind(id,viewer.id,input.communityId,input.channelId,identity.fingerprint,now)]:[]),
      quota.statement,
      database.prepare(`SELECT CASE WHEN changes()=1 AND ${consumed} THEN 1 ELSE json_extract('invalid-json','$') END`).bind(...consumedValues),
      insertMessage,
      database.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM community_channel_messages WHERE id=? AND channel_id=? AND author_profile_id=? AND body=? AND created_at=? AND kind=? AND reply_to_message_id IS ? AND ${policy} AND ${consumed} ${operationProof}) THEN 1 ELSE json_extract('invalid-json','$') END`).bind(id,input.channelId,viewer.id,input.body,now,input.kind,input.replyToMessageId??null,...policyValues,...consumedValues,...(identity?[id,viewer.id,input.communityId,input.channelId,identity.fingerprint,now]:[])),
    ]);
  } catch (error) {
    operation=await readOperation();
    if(!operation){await quota.rethrowIfExhausted();throw error;}
    now=operation.created_at;
  }
  }
  if (!operation?.completed_at) {
  if (operation && imageIds.length) {
    const attached = await database.prepare("SELECT id FROM social_post_images WHERE post_id = ? AND owner_profile_id = ? AND status = 'published' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL").bind(id,viewer.id).all<{id:string}>();
    const attachedIds = new Set(attached.results.map(image => image.id));
    await validatePendingImages(database,viewer.id,imageIds.filter(imageId => !attachedIds.has(imageId)));
  }
  await publishImages(database, viewer.id, id, imageIds);
  if (imageIds.length) {
    const published = await database.prepare("SELECT id FROM social_post_images WHERE post_id = ? AND owner_profile_id = ? AND status = 'published' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL")
      .bind(id, viewer.id).all<{ id: string }>();
    const publishedIds = new Set(published.results.map(image => image.id));
    if (publishedIds.size !== imageIds.length || imageIds.some(imageId => !publishedIds.has(imageId))) {
      throw new Error("画像の添付を完了できませんでした。再送してください。");
    }
  }
  const { applyCommunityAutoRoles } = await import("@/lib/server/d1-community-automation");
  await applyCommunityAutoRoles(database, input.communityId);
  const recipients = new Map<string, Set<"mention" | "reply">>();
  const addRecipient = (profileId: string, kind: "mention" | "reply") => {
    const kinds = recipients.get(profileId) ?? new Set<"mention" | "reply">();
    kinds.add(kind);
    recipients.set(profileId, kinds);
  };
  if (input.replyToMessageId) {
    const replied = await database.prepare("SELECT author_profile_id FROM community_channel_messages WHERE id = ? LIMIT 1")
      .bind(input.replyToMessageId).first<{ author_profile_id: string }>();
    if (replied?.author_profile_id) addRecipient(replied.author_profile_id, "reply");
  }
  const handles = extractSocialMentionHandles(input.body);
  if (handles.length) {
    const placeholders = handles.map(() => "?").join(", ");
    const mentioned = await database.prepare(`SELECT id FROM profiles WHERE lower(handle) IN (${placeholders})`).bind(...handles).all<{ id: string }>();
    for (const profile of mentioned.results) addRecipient(profile.id, "mention");
  }
  await Promise.all([...recipients].map(async ([receiverProfileId, kinds]) => {
    const wantsReply = kinds.has("reply");
    const wantsMention = kinds.has("mention");
    const eligible = await database.prepare(`SELECT 1 AS allowed
      FROM community_memberships membership
      LEFT JOIN community_notification_preferences community_preference
        ON community_preference.community_id = membership.community_id
        AND community_preference.profile_id = membership.profile_id
      LEFT JOIN community_channel_notification_preferences channel_preference
        ON channel_preference.channel_id = ?
        AND channel_preference.profile_id = membership.profile_id
      WHERE membership.community_id = ? AND membership.profile_id = ?
        AND membership.status = 'active'
        AND ((? = 1 AND coalesce(community_preference.replies, 1) = 1)
          OR (? = 1 AND coalesce(community_preference.mentions, 1) = 1))
        AND coalesce(channel_preference.mode, 'mentions') != 'none'
        AND (channel_preference.muted_until IS NULL OR channel_preference.muted_until <= ?)
        AND NOT EXISTS (
          SELECT 1 FROM profile_moderation_status moderation
          WHERE moderation.profile_id = membership.profile_id
            AND moderation.status = 'suspended'
        )
        AND NOT EXISTS (
          SELECT 1 FROM thread_user_controls control
          WHERE control.blocked = 1 AND (
            (control.owner_profile_id = ? AND control.target_profile_id = membership.profile_id)
            OR (control.owner_profile_id = membership.profile_id AND control.target_profile_id = ?)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM community_member_custom_roles member_role
          JOIN community_channel_permissions permission
            ON permission.role_id = member_role.role_id AND permission.channel_id = ?
          WHERE member_role.community_id = membership.community_id
            AND member_role.profile_id = membership.profile_id
            AND permission.can_view = 0
        )
      LIMIT 1`)
      .bind(
        input.channelId,
        input.communityId,
        receiverProfileId,
        Number(wantsReply),
        Number(wantsMention),
        now,
        viewer.id,
        viewer.id,
        input.channelId,
      )
      .first<{ allowed: number }>();
    if (!eligible) return;
    const eventKind = wantsReply ? "reply" : "mention";
    await createD1HubNotification(database, {
      receiverProfileId,
      actorProfileId: viewer.id,
      text: eventKind === "reply"
        ? "コミュニティで返信が届きました。"
        : "コミュニティでメンションされました。",
      route: `/community?community=${encodeURIComponent(input.communityId)}&channel=${encodeURIComponent(input.channelId)}`,
      dedupeKey: `community-message:${id}:${receiverProfileId}`,
      createdAt: now,
      community: {
        communityId: input.communityId,
        channelId: input.channelId,
        messageId: id,
        eventKind,
      },
    });
  }));
  if (identity) await database.prepare("UPDATE community_message_operations SET completed_at = ? WHERE message_id = ? AND deleted_at IS NULL").bind(new Date().toISOString(),id).run();
  }
  const messages = await listD1CommunityChannelMessages(
    database,
    input.communityId,
    input.channelId,
    viewer.id,
    id,
  );
  const message = messages.find((candidate) => candidate.id === id);
  if (!message) throw new Error("投稿を保存できませんでした。");
  return message;
}

async function requireMessageContext(
  database: D1Database,
  input: { communityId: string; channelId: string; messageId: string },
) {
  const message = await database.prepare(`SELECT m.id, m.author_profile_id AS authorProfileId
    FROM community_channel_messages m
    JOIN community_channels c ON c.id = m.channel_id
    WHERE m.id = ? AND m.channel_id = ? AND c.community_id = ? LIMIT 1`)
    .bind(input.messageId, input.channelId, input.communityId)
    .first<{ id: string; authorProfileId: string }>();
  if (!message) throw new Error("Message does not exist in this channel.");
  return message;
}

async function requireMessageOwnerOrManager(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: { communityId: string; channelId: string; messageId: string },
) {
  const message = await requireMessageContext(database, input);
  if (message.authorProfileId === viewer.id) return message;
  await requireManager(database, input.communityId, viewer.id);
  return message;
}

export async function updateD1CommunityChannelMessage(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: { communityId: string; channelId: string; messageId: string; body: string },
) {
  await requireActiveMember(
    database,
    input.communityId,
    viewer.id,
    input.channelId,
  );
  const message = await requireMessageContext(database, input);
  if (message.authorProfileId !== viewer.id) {
    throw new CommunityPermissionError(
      "投稿本文を編集できるのは投稿者本人だけです。",
    );
  }
  const body = input.body.normalize("NFKC").trim();
  if (!body || body.length > 2000) throw new Error("Message body must be between 1 and 2000 characters.");
  const editedAt = new Date().toISOString();
  await database.prepare(`UPDATE community_channel_messages SET body = ?, edited_at = ?
    WHERE id = ? AND channel_id = ?`).bind(body, editedAt, input.messageId, input.channelId).run();
  return { id: input.messageId, body, editedAt };
}

export async function deleteD1CommunityChannelMessage(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: { communityId: string; channelId: string; messageId: string },
) {
  await requireActiveMember(
    database,
    input.communityId,
    viewer.id,
    input.channelId,
  );
  const message = await requireMessageOwnerOrManager(database, viewer, input);
  const [deleted] = await database.batch([
    database.prepare("DELETE FROM community_channel_messages WHERE id = ? AND channel_id = ?")
      .bind(input.messageId, input.channelId),
    database.prepare(`DELETE FROM notifications
      WHERE target_type = 'community_message' AND target_id = ?`)
      .bind(input.messageId),
    database.prepare(`UPDATE social_post_images SET status = 'deleted'
      WHERE post_id = ? AND owner_profile_id = ? AND status IN ('pending', 'published')`)
      .bind(input.messageId, message.authorProfileId),
  ]);
  if (!deleted.meta.changes) throw new Error("Message could not be deleted.");
  return { deleted: true as const, messageId: input.messageId };
}

export async function setD1CommunityChannelMessagePinned(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: { communityId: string; channelId: string; messageId: string; pinned: boolean },
) {
  await requireManager(database, input.communityId, viewer.id);
  await requireMessageContext(database, input);
  const pinnedAt = input.pinned ? new Date().toISOString() : null;
  await database.prepare(`UPDATE community_channel_messages
    SET pinned_at = ?, pinned_by_profile_id = ?
    WHERE id = ? AND channel_id = ?`)
    .bind(pinnedAt, input.pinned ? viewer.id : null, input.messageId, input.channelId).run();
  return { id: input.messageId, pinnedAt, pinnedByProfileId: input.pinned ? viewer.id : null };
}

export async function setD1CommunityChannelMessageWorkflow(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: {
    communityId: string;
    channelId: string;
    messageId: string;
    workflowStatus: "open" | "resolved" | "closed";
  },
) {
  await requireManager(database, input.communityId, viewer.id);
  await requireMessageContext(database, input);
  await database.prepare(`UPDATE community_channel_messages SET workflow_status = ?
    WHERE id = ? AND channel_id = ?`)
    .bind(input.workflowStatus, input.messageId, input.channelId).run();
  return { id: input.messageId, workflowStatus: input.workflowStatus };
}

export async function toggleD1CommunityChannelReaction(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: {
    communityId: string;
    channelId: string;
    messageId: string;
    emoji: CommunityChannelReaction["emoji"];
  },
) {
  await requireActiveMember(database, input.communityId, viewer.id, input.channelId);
  await requireMessageContext(database, input);
  const existing = await database.prepare(`SELECT 1 AS present FROM community_channel_reactions
    WHERE message_id = ? AND profile_id = ? AND emoji = ? LIMIT 1`)
    .bind(input.messageId, viewer.id, input.emoji).first<{ present: number }>();
  if (existing) {
    await database.prepare(`DELETE FROM community_channel_reactions
      WHERE message_id = ? AND profile_id = ? AND emoji = ?`)
      .bind(input.messageId, viewer.id, input.emoji).run();
  } else {
    await database.prepare(`INSERT INTO community_channel_reactions
      (message_id, profile_id, emoji, created_at) VALUES (?, ?, ?, ?)`)
      .bind(input.messageId, viewer.id, input.emoji, new Date().toISOString()).run();
  }
  return { active: !existing, messageId: input.messageId, emoji: input.emoji };
}

export async function reportD1CommunityChannelMessage(
  database: D1Database,
  viewer: Pick<Profile, "id">,
  input: {
    communityId: string;
    channelId: string;
    messageId: string;
    reason: "spam" | "harassment" | "other";
  },
) {
  await requireActiveMember(database, input.communityId, viewer.id, input.channelId);
  const message = await requireMessageContext(database, input);
  if (message.authorProfileId === viewer.id) throw new Error("You cannot report your own message.");
  const existing = await database.prepare(`SELECT id, created_at AS createdAt FROM community_message_reports
    WHERE message_id = ? AND reporter_profile_id = ? AND status = 'open' LIMIT 1`)
    .bind(input.messageId, viewer.id).first<{ id: string; createdAt: string }>();
  if (existing) return { reportId: existing.id, createdAt: existing.createdAt, duplicate: true };
  const reportId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await database.prepare(`INSERT INTO community_message_reports
    (id, community_id, channel_id, message_id, reporter_profile_id, reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
    .bind(
      reportId,
      input.communityId,
      input.channelId,
      input.messageId,
      viewer.id,
      input.reason,
      createdAt,
    ).run();
  return { reportId, createdAt, duplicate: false };
}
