import type { D1Database } from "@cloudflare/workers-types";

import type { DirectMessage, MessageConversation, Profile } from "@/lib/domain";
import {
  attachImagesToDmMessages,
  MAX_DM_IMAGES,
  publishDmImages,
  validatePendingDmImages,
  type DirectMessageImage,
} from "@/lib/server/direct-message-images";
import { requireNoD1BlockBetween } from "@/lib/server/profile-blocks";

export type DirectMessageReceivePolicy = "mutuals" | "following" | "nobody";
export type DirectMessageErrorCode =
  | "conversation_not_found"
  | "e2ee_not_available"
  | "invalid_message"
  | "invalid_image"
  | "invalid_request_id"
  | "request_conflict"
  | "invalid_recipient"
  | "messages_not_allowed"
  | "profile_not_found"
  | "rate_limited";

const DM_IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function remoteRecipientError() {
  return new DirectMessageError(
    "invalid_recipient",
    "他のハブの人にはダイレクトメッセージを送れません。返信やメンションを使ってください。",
    400,
  );
}

export class DirectMessageError extends Error {
  constructor(
    public readonly code: DirectMessageErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "DirectMessageError";
  }
}

export type NotificationPreferences = {
  replies: boolean;
  reactions: boolean;
  follows: boolean;
  messages: boolean;
  commercePayments: boolean;
  commerceDelivery: boolean;
  commerceReturns: boolean;
};

const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  replies: true,
  reactions: true,
  follows: true,
  messages: true,
  commercePayments: true,
  commerceDelivery: true,
  commerceReturns: true,
};

function orderedPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

async function consumeDirectMessageQuota(
  database: D1Database,
  profileId: string,
  action: "start" | "send",
  now = new Date(),
) {
  const windowMs = action === "send" ? 60_000 : 60 * 60_000;
  const limit = action === "send" ? 30 : 20;
  const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowStartedAt = new Date(windowStartMs).toISOString();
  const expiresAt = new Date(windowStartMs + windowMs).toISOString();
  const result = await database.prepare(`INSERT INTO direct_message_rate_limits
      (profile_id, action, window_started_at, request_count, expires_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(profile_id, action, window_started_at) DO UPDATE SET
      request_count = request_count + 1
    WHERE request_count < ?`)
    .bind(profileId, action, windowStartedAt, expiresAt, limit)
    .run();
  if (!result.meta.changes) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + windowMs - now.getTime()) / 1000));
    throw new DirectMessageError(
      "rate_limited",
      "送信回数が上限に達しました。しばらく待ってからもう一度お試しください。",
      429,
      retryAfterSeconds,
    );
  }
}

async function canSendTo(database: D1Database, senderId: string, recipientId: string) {
  await requireNoD1BlockBetween(database, senderId, recipientId);
  const preference = await database.prepare(`SELECT receive_policy FROM direct_message_preferences
    WHERE profile_id = ? LIMIT 1`).bind(recipientId).first<{ receive_policy: DirectMessageReceivePolicy }>();
  const policy = preference?.receive_policy ?? "mutuals";
  if (policy === "nobody") return false;
  const follows = await database.prepare(`SELECT
      EXISTS(SELECT 1 FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ?) AS recipient_follows_sender,
      EXISTS(SELECT 1 FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ?) AS sender_follows_recipient`)
    .bind(recipientId, senderId, senderId, recipientId)
    .first<{ recipient_follows_sender: number; sender_follows_recipient: number }>();
  if (!follows?.recipient_follows_sender) return false;
  return policy === "following" || Boolean(follows.sender_follows_recipient);
}

export async function getD1DirectMessagePreferences(database: D1Database, profileId: string) {
  const row = await database.prepare(`SELECT receive_policy FROM direct_message_preferences
    WHERE profile_id = ? LIMIT 1`).bind(profileId).first<{ receive_policy: DirectMessageReceivePolicy }>();
  return row?.receive_policy ?? "mutuals";
}

export async function setD1DirectMessagePreferences(database: D1Database, profileId: string, policy: DirectMessageReceivePolicy) {
  await database.prepare(`INSERT INTO direct_message_preferences (profile_id, receive_policy, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET receive_policy = excluded.receive_policy, updated_at = excluded.updated_at`)
    .bind(profileId, policy, new Date().toISOString()).run();
  return policy;
}

export async function getD1NotificationPreferences(database: D1Database, profileId: string): Promise<NotificationPreferences> {
  const row = await database.prepare(`SELECT replies_enabled, reactions_enabled, follows_enabled, messages_enabled,
      commerce_payments_enabled, commerce_delivery_enabled, commerce_returns_enabled
    FROM notification_preferences WHERE profile_id = ? LIMIT 1`).bind(profileId).first<{
      replies_enabled: number; reactions_enabled: number; follows_enabled: number; messages_enabled: number;
      commerce_payments_enabled: number; commerce_delivery_enabled: number; commerce_returns_enabled: number;
    }>();
  return row ? {
    replies: Boolean(row.replies_enabled),
    reactions: Boolean(row.reactions_enabled),
    follows: Boolean(row.follows_enabled),
    messages: Boolean(row.messages_enabled),
    commercePayments: Boolean(row.commerce_payments_enabled),
    commerceDelivery: Boolean(row.commerce_delivery_enabled),
    commerceReturns: Boolean(row.commerce_returns_enabled),
  } : DEFAULT_NOTIFICATIONS;
}

export async function setD1NotificationPreferences(database: D1Database, profileId: string, preferences: NotificationPreferences) {
  await database.prepare(`INSERT INTO notification_preferences
    (profile_id, replies_enabled, reactions_enabled, follows_enabled, messages_enabled,
     commerce_payments_enabled, commerce_delivery_enabled, commerce_returns_enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET
      replies_enabled = excluded.replies_enabled,
      reactions_enabled = excluded.reactions_enabled,
      follows_enabled = excluded.follows_enabled,
      messages_enabled = excluded.messages_enabled,
      commerce_payments_enabled = excluded.commerce_payments_enabled,
      commerce_delivery_enabled = excluded.commerce_delivery_enabled,
      commerce_returns_enabled = excluded.commerce_returns_enabled,
      updated_at = excluded.updated_at`)
    .bind(profileId, preferences.replies ? 1 : 0, preferences.reactions ? 1 : 0,
      preferences.follows ? 1 : 0, preferences.messages ? 1 : 0,
      preferences.commercePayments ? 1 : 0, preferences.commerceDelivery ? 1 : 0,
      preferences.commerceReturns ? 1 : 0, new Date().toISOString()).run();
  return preferences;
}

export async function startD1DirectMessage(database: D1Database, viewerId: string, targetProfileId: string) {
  if (viewerId === targetProfileId) {
    throw new DirectMessageError("invalid_recipient", "自分自身にはメッセージを送れません。", 400);
  }
  const target = await database.prepare("SELECT id, kind FROM profiles WHERE id = ? LIMIT 1").bind(targetProfileId).first<{ id: string; kind?: string | null }>();
  if (!target) throw new DirectMessageError("profile_not_found", "プロフィールが見つかりません。", 404);
  // 他のハブの人（影のプロフィール）へのDMは配送先が無い。会話を作らない。
  if (target.kind === "remote") throw remoteRecipientError();
  if (!await canSendTo(database, viewerId, targetProfileId)) {
    throw new DirectMessageError("messages_not_allowed", "このユーザーはメッセージを受け付けていません。", 403);
  }
  const [first, second] = orderedPair(viewerId, targetProfileId);
  const existing = await database.prepare(`SELECT conversation_id FROM direct_conversation_pairs
    WHERE first_profile_id = ? AND second_profile_id = ? LIMIT 1`).bind(first, second).first<{ conversation_id: string }>();
  if (existing) return { conversationId: existing.conversation_id, createdNew: false };

  await consumeDirectMessageQuota(database, viewerId, "start");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO conversations
      (id, is_e2ee, verification_status, fingerprint, created_at, last_message_at)
      VALUES (?, 0, 'unverified', '', ?, ?)`).bind(id, now, now),
    database.prepare(`INSERT INTO direct_conversation_pairs
      (first_profile_id, second_profile_id, conversation_id, created_at) VALUES (?, ?, ?, ?)`)
      .bind(first, second, id, now),
    database.prepare(`INSERT INTO conversation_participants
      (conversation_id, profile_id, unread_count, joined_at, last_read_at) VALUES (?, ?, 0, ?, ?)`)
      .bind(id, viewerId, now, now),
    database.prepare(`INSERT INTO conversation_participants
      (conversation_id, profile_id, unread_count, joined_at, last_read_at) VALUES (?, ?, 0, ?, NULL)`)
      .bind(id, targetProfileId, now),
  ]);
  return { conversationId: id, createdNew: true };
}

export async function listD1DirectMessagePageData(
  database: D1Database,
  viewerId: string,
  requestedConversationId?: string,
) {
  const conversationRows = await database.prepare(`SELECT c.id, c.is_e2ee, c.verification_status, c.fingerprint, c.last_message_at,
      mine.unread_count
    FROM conversations c
    JOIN conversation_participants mine ON mine.conversation_id = c.id AND mine.profile_id = ?
    WHERE NOT EXISTS (
      SELECT 1 FROM conversation_participants other
      JOIN thread_user_controls control ON control.blocked = 1 AND (
        (control.owner_profile_id = ? AND control.target_profile_id = other.profile_id)
        OR (control.owner_profile_id = other.profile_id AND control.target_profile_id = ?)
      )
      WHERE other.conversation_id = c.id AND other.profile_id <> ?
    )
    ORDER BY c.last_message_at DESC LIMIT 100`)
    .bind(viewerId, viewerId, viewerId, viewerId).all<{
      id: string; is_e2ee: number; verification_status: "verified" | "unverified"; fingerprint: string;
      last_message_at: string; unread_count: number;
  }>();
  const ids = conversationRows.results.map((row) => row.id);
  if (!ids.length) return { conversations: [] as MessageConversation[], messages: [] as DirectMessage[], profiles: [] as Profile[] };
  const activeConversationId = ids.includes(requestedConversationId ?? "")
    ? requestedConversationId!
    : ids[0]!;
  const placeholders = ids.map(() => "?").join(",");
  const [participantRows, messageRows] = await Promise.all([
    database.prepare(`SELECT conversation_id, profile_id, unread_count FROM conversation_participants
      WHERE conversation_id IN (${placeholders})`).bind(...ids).all<{ conversation_id: string; profile_id: string; unread_count: number }>(),
    database.prepare(`WITH ranked_messages AS (
      SELECT id, conversation_id, sender_profile_id, encrypted_payload, preview_text,
        encryption_version, encryption_state, created_at,
        ROW_NUMBER() OVER (
          PARTITION BY conversation_id
          ORDER BY datetime(created_at) DESC, id DESC
        ) AS row_number
      FROM direct_messages
      WHERE conversation_id IN (${placeholders}) AND encryption_state = 'sealed'
    )
    SELECT id, conversation_id, sender_profile_id, encrypted_payload, preview_text,
      encryption_version, encryption_state, created_at
    FROM ranked_messages
    WHERE row_number = 1 OR (conversation_id = ? AND row_number <= 200)
    ORDER BY datetime(created_at) ASC, id ASC`).bind(...ids, activeConversationId).all<{
        id: string; conversation_id: string; sender_profile_id: string; encrypted_payload: string; preview_text: string;
        encryption_version: string; encryption_state: "sealed" | "draft"; created_at: string;
      }>(),
  ]);
  const profileIds = [...new Set(participantRows.results.map((row) => row.profile_id))];
  const profilePlaceholders = profileIds.map(() => "?").join(",");
  const profileRows = await database.prepare(`SELECT id, handle, display_name, bio, avatar_url, joined_at
    FROM profiles WHERE id IN (${profilePlaceholders})`).bind(...profileIds).all<{
      id: string; handle: string; display_name: string; bio: string; avatar_url: string | null; joined_at: string;
    }>();
  const messages: DirectMessage[] = messageRows.results.map((row) => ({
    id: row.id, conversationId: row.conversation_id, senderProfileId: row.sender_profile_id,
    encryptedPayload: "", previewText: row.preview_text,
    encryptionVersion: row.encryption_version, encryptionState: row.encryption_state, createdAt: row.created_at,
  }));
  await attachImagesToDmMessages(database, messages);
  return {
    conversations: conversationRows.results.map((row) => {
      const participants = participantRows.results.filter((item) => item.conversation_id === row.id);
      return {
        id: row.id,
        participantIds: participants.map((item) => item.profile_id),
        isE2ee: Boolean(row.is_e2ee),
        verificationStatus: row.verification_status,
        fingerprint: row.fingerprint,
        unreadCountByProfileId: Object.fromEntries(participants.map((item) => [item.profile_id, Number(item.unread_count)])),
        lastMessageAt: row.last_message_at,
      };
    }),
    messages,
    profiles: profileRows.results.map((row) => ({
      id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio,
      avatarUrl: row.avatar_url ?? undefined, joinedAt: row.joined_at,
    })),
  };
}

export async function countD1UnreadDirectMessages(
  database: D1Database,
  viewerId: string,
): Promise<number> {
  const row = await database.prepare(`SELECT COALESCE(SUM(mine.unread_count), 0) AS total
    FROM conversation_participants mine
    JOIN conversations conversation ON conversation.id = mine.conversation_id
    WHERE mine.profile_id = ?
    AND NOT EXISTS (
      SELECT 1 FROM conversation_participants other
      JOIN thread_user_controls control ON control.blocked = 1 AND (
        (control.owner_profile_id = ? AND control.target_profile_id = other.profile_id)
        OR (control.owner_profile_id = other.profile_id AND control.target_profile_id = ?)
      )
      WHERE other.conversation_id = conversation.id AND other.profile_id <> ?
    )`)
    .bind(viewerId, viewerId, viewerId, viewerId)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}

async function getConversationPartner(database: D1Database, conversationId: string, viewerId: string) {
  const viewer = await database.prepare(`SELECT 1 AS participant FROM conversation_participants
    WHERE conversation_id = ? AND profile_id = ? LIMIT 1`).bind(conversationId, viewerId).first();
  if (!viewer) throw new DirectMessageError("conversation_not_found", "会話が見つかりません。", 404);
  const partner = await database.prepare(`SELECT profile_id FROM conversation_participants
    WHERE conversation_id = ? AND profile_id <> ? LIMIT 1`).bind(conversationId, viewerId).first<{ profile_id: string }>();
  if (!partner) throw new DirectMessageError("conversation_not_found", "会話相手が見つかりません。", 404);
  return partner.profile_id;
}

export async function sendD1DirectMessage(database: D1Database, conversationId: string, senderId: string, text: string, clientRequestId?: string, imageIds: string[] = []) {
  if (imageIds.length > MAX_DM_IMAGES || new Set(imageIds).size !== imageIds.length || !imageIds.every((id) => DM_IMAGE_ID_PATTERN.test(id))) {
    throw new DirectMessageError("invalid_image", "画像の指定が正しくありません。", 400);
  }
  const body = text.trim();
  if ((!body && !imageIds.length) || body.length > 280) {
    throw new DirectMessageError("invalid_message", "メッセージは1〜280文字で入力してください。", 400);
  }
  const recipientId = await getConversationPartner(database, conversationId, senderId);
  const recipient = await database.prepare("SELECT kind FROM profiles WHERE id = ? LIMIT 1").bind(recipientId).first<{ kind?: string | null }>();
  if (recipient?.kind === "remote") throw remoteRecipientError();
  // E2EE is unavailable. Never save plaintext text or images to a row marked E2EE.
  const conversation = await database.prepare("SELECT is_e2ee FROM conversations WHERE id = ? LIMIT 1")
    .bind(conversationId).first<{ is_e2ee: number }>();
  if (conversation?.is_e2ee) {
    throw new DirectMessageError("e2ee_not_available", "この会話ではエンドツーエンド暗号化を利用できません。", 409);
  }
  if (!await canSendTo(database, senderId, recipientId)) {
    throw new DirectMessageError("messages_not_allowed", "このユーザーにはメッセージを送れません。", 403);
  }
  if (clientRequestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientRequestId)) {
    throw new DirectMessageError("invalid_request_id", "送信識別子が正しくありません。", 400);
  }
  let id: string = crypto.randomUUID();
  if (clientRequestId) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["hub-dm-send-v1", senderId, conversationId, clientRequestId.toLowerCase()])));
    id = "dm-" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // pending の画像をメッセージへ結び、付いた分を読み直す。冪等の再送では
  // 前回付けきれなかった分がここで完了する。
  const publishAndLoad = async (messageId: string): Promise<DirectMessageImage[]> => {
    if (imageIds.length) await publishDmImages(database, senderId, messageId, imageIds);
    const holder: { id: string; images?: DirectMessageImage[] } = { id: messageId };
    await attachImagesToDmMessages(database, [holder]);
    return holder.images ?? [];
  };
  const readExisting = async () => {
    if (!clientRequestId) return null;
    const row = await database.prepare("SELECT id, conversation_id, sender_profile_id, preview_text, created_at FROM direct_messages WHERE id = ?")
      .bind(id).first<{ id: string; conversation_id: string; sender_profile_id: string; preview_text: string; created_at: string }>();
    if (!row) return null;
    if (row.conversation_id !== conversationId || row.sender_profile_id !== senderId || row.preview_text !== body) {
      throw new DirectMessageError("request_conflict", "同じ送信識別子で内容を変更できません。", 409);
    }
    const images = await publishAndLoad(row.id);
    const attachedIds = new Set(images.map((image) => image.id));
    if (attachedIds.size !== imageIds.length || imageIds.some((imageId) => !attachedIds.has(imageId))) {
      throw new DirectMessageError("request_conflict", "同じ送信識別子で内容を変更できません。", 409);
    }
    return { id: row.id, conversationId, senderProfileId: senderId, encryptedPayload: "", previewText: row.preview_text,
      encryptionVersion: "plaintext-v1", encryptionState: "sealed" as const, createdAt: row.created_at, images };
  };
  const existing = await readExisting();
  if (existing) return existing;
  try {
    await validatePendingDmImages(database, senderId, imageIds);
  } catch (error) {
    throw new DirectMessageError("invalid_image", error instanceof Error ? error.message : "送信できない画像が含まれています。", 400);
  }
  await consumeDirectMessageQuota(database, senderId, "send");
  const now = new Date().toISOString();
  const notifications = await getD1NotificationPreferences(database, recipientId);
  const statements = [
    database.prepare(`INSERT INTO direct_messages
      (id, conversation_id, sender_profile_id, encrypted_payload, preview_text, encryption_version, encryption_state, created_at)
      VALUES (?, ?, ?, ?, ?, 'plaintext-v1', 'sealed', ?)`)
      .bind(id, conversationId, senderId, `plaintext-v1:${body}`, body, now),
    database.prepare("UPDATE conversations SET last_message_at = ? WHERE id = ?").bind(now, conversationId),
    database.prepare(`UPDATE conversation_participants SET unread_count = unread_count + 1
      WHERE conversation_id = ? AND profile_id = ?`).bind(conversationId, recipientId),
  ];
  if (notifications.messages) {
    statements.push(database.prepare(`INSERT INTO notifications
      (id, receiver_profile_id, actor_profile_id, notification_type, target_type, target_id, text, is_read, created_at)
      VALUES (?, ?, ?, 'message_received', 'message_conversation', ?, '新しいメッセージがあります。', 0, ?)`)
      .bind(crypto.randomUUID(), recipientId, senderId, conversationId, now));
  }
  try {
    await database.batch(statements);
  } catch (error) {
    const committed = await readExisting();
    if (committed) return committed;
    throw error;
  }
  const images = await publishAndLoad(id);
  if (images.length !== imageIds.length) {
    throw new DirectMessageError("invalid_image", "画像の添付を完了できませんでした。再送してください。", 500);
  }
  return {
    id, conversationId, senderProfileId: senderId, encryptedPayload: "",
    previewText: body, encryptionVersion: "plaintext-v1", encryptionState: "sealed" as const, createdAt: now,
    images,
  };
}

export async function markD1ConversationRead(database: D1Database, conversationId: string, viewerId: string) {
  const [result] = await database.batch([
    database.prepare(`UPDATE conversation_participants SET unread_count = 0, last_read_at = ?
      WHERE conversation_id = ? AND profile_id = ?`).bind(new Date().toISOString(), conversationId, viewerId),
    database.prepare(`UPDATE notifications SET is_read = 1
      WHERE receiver_profile_id = ? AND target_type = 'message_conversation' AND target_id = ? AND is_read = 0
      AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND profile_id = ?)`)
      .bind(viewerId, conversationId, conversationId, viewerId),
  ]);
  if (!result.meta.changes) {
    throw new DirectMessageError("conversation_not_found", "会話が見つかりません。", 404);
  }
  return { conversationId, unreadCount: 0 };
}

export async function getD1DirectMessageConversation(
  database: D1Database,
  conversationId: string,
  viewerId: string,
) {
  await getConversationPartner(database, conversationId, viewerId);
  const page = await listD1DirectMessagePageData(database, viewerId, conversationId);
  const conversation = page.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    throw new DirectMessageError("conversation_not_found", "会話が見つかりません。", 404);
  }
  return {
    conversation,
    messages: page.messages.filter((item) => item.conversationId === conversationId),
    profiles: page.profiles.filter((profile) => conversation.participantIds.includes(profile.id)),
  };
}
