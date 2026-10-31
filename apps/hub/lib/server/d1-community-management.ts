import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";

export type CommunityVisibility = "public" | "approval" | "private";

export async function requireD1ActiveCommunityMembership(
  database: D1Database,
  profileId: string,
  communityId: string,
) {
  const membership = await database.prepare(
    `SELECT role, status FROM community_memberships
     WHERE community_id = ? AND profile_id = ? LIMIT 1`,
  ).bind(communityId, profileId)
    .first<{ role: "owner" | "moderator" | "member"; status: "active" | "muted" | "banned" }>();
  if (!membership || membership.status !== "active") {
    throw new Error("このコミュニティを利用できません。");
  }
  return membership;
}

function communitySlug(name: string) {
  const base = name
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "community"}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createD1Community(
  database: D1Database,
  actor: Profile,
  input: {
    id?: string;
    name: string;
    description: string;
    category: string;
    visibility: CommunityVisibility;
    imageUrl?: string;
  },
) {
  const duplicate = await database.prepare(`SELECT name, slug FROM communities
    WHERE lower(trim(name)) = lower(trim(?)) AND lower(trim(category)) = lower(trim(?))
    AND lifecycle_status = 'active' LIMIT 1`).bind(input.name, input.category).first<{ name: string; slug: string }>();
  if (duplicate) throw new Error(`同じカテゴリに「${duplicate.name}」があります。既存コミュニティを確認してください。`);
  const id = input.id ?? `community-${crypto.randomUUID()}`;
  const channelId = crypto.randomUUID();
  const slug = communitySlug(input.name);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO communities
      (id, slug, name, description, category, owner_profile_id, image_url, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, slug, input.name, input.description, input.category, actor.id, input.imageUrl ?? null, input.visibility, now, now),
    database.prepare(`INSERT INTO community_memberships
      (community_id, profile_id, role, status, joined_at)
      VALUES (?, ?, 'owner', 'active', ?)`)
      .bind(id, actor.id, now),
    database.prepare(`INSERT INTO community_channels
      (id, community_id, name, description, position, created_at)
      VALUES (?, ?, '一般', 'コミュニティの会話を始める場所', 0, ?)`)
      .bind(channelId, id, now),
    database.prepare(`INSERT INTO community_notification_preferences
      (community_id, profile_id, updated_at) VALUES (?, ?, ?)`)
      .bind(id, actor.id, now),
    database.prepare(`INSERT INTO community_audit_log
      (id, community_id, actor_profile_id, action, detail, created_at)
      VALUES (?, ?, ?, 'community_created', ?, ?)`)
      .bind(crypto.randomUUID(), id, actor.id, input.visibility, now),
  ]);
  const { id: _requestedId, ...publicInput } = input;
  return { id, slug, ...publicInput, ownerProfileId: actor.id, createdAt: now };
}

export class CommunityMembershipError extends Error{readonly status=400;}

export async function toggleD1CommunityMembership(
  database: D1Database,
  actor: Profile,
  communityId: string,
  desiredJoined?: boolean,
) {
  const community = await database.prepare(
    `SELECT owner_profile_id, visibility, lifecycle_status FROM communities WHERE id = ? LIMIT 1`,
  ).bind(communityId).first<{ owner_profile_id: string; visibility: CommunityVisibility; lifecycle_status: "active" | "closed" }>();
  if (!community) throw new CommunityMembershipError("コミュニティが見つかりません。");
  if (community.lifecycle_status === "closed") throw new CommunityMembershipError("このコミュニティは閉鎖されています。");
  const membership = await database.prepare(
    `SELECT role, status FROM community_memberships WHERE community_id = ? AND profile_id = ? LIMIT 1`,
  ).bind(communityId, actor.id)
    .first<{ role: string; status: "active" | "muted" | "banned" }>();
  if (membership?.role === "owner") throw new CommunityMembershipError("オーナーはコミュニティから退出できません。");
  if (membership?.status === "banned") throw new CommunityMembershipError("このコミュニティには参加できません。");
  if (membership?.status === "muted") throw new CommunityMembershipError("制限中はコミュニティから退出できません。");
  if (desiredJoined === true && membership) return { joined: true, pending: false };
  if (desiredJoined === false && !membership) {
    const request = await database.prepare("SELECT status FROM community_membership_requests WHERE community_id = ? AND profile_id = ? LIMIT 1")
      .bind(communityId, actor.id).first<{ status: string }>();
    return { joined: false, pending: request?.status === "pending" };
  }
  const now = new Date().toISOString();
  if (membership) {
    await database.batch([
      database.prepare(`DELETE FROM community_memberships WHERE community_id = ? AND profile_id = ?`).bind(communityId, actor.id),
      database.prepare(`DELETE FROM community_notification_preferences WHERE community_id = ? AND profile_id = ?`).bind(communityId, actor.id),
      database.prepare(`DELETE FROM community_channel_notification_preferences
        WHERE profile_id = ? AND channel_id IN (
          SELECT id FROM community_channels WHERE community_id = ?
        )`).bind(actor.id, communityId),
      database.prepare(`DELETE FROM notifications
        WHERE receiver_profile_id = ? AND id IN (
          SELECT notification_id FROM community_notification_events
          WHERE community_id = ?
        )`).bind(actor.id, communityId),
      database.prepare(`INSERT INTO community_audit_log
        (id, community_id, actor_profile_id, action, created_at) VALUES (?, ?, ?, 'member_left', ?)`)
        .bind(crypto.randomUUID(), communityId, actor.id, now),
    ]);
    return { joined: false, pending: false };
  }
  if (community.visibility === "private") throw new CommunityMembershipError("このコミュニティは招待制です。");
  if (community.visibility === "approval") {
    try {
      await database.prepare(`INSERT INTO community_membership_requests
        (community_id, profile_id, status, created_at) VALUES (?, ?, 'pending', ?)
        ON CONFLICT(community_id, profile_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at,
          resolved_at = NULL, resolved_by_profile_id = NULL, resolution_operation_id = NULL
        WHERE community_membership_requests.status <> 'pending'`)
        .bind(communityId, actor.id, now).run();
    } catch (error) {
      if (!/no such column:\s*resolution_operation_id/i.test(error instanceof Error ? error.message : "")) {
        throw error;
      }
      await database.prepare(`INSERT INTO community_membership_requests
        (community_id, profile_id, status, created_at) VALUES (?, ?, 'pending', ?)
        ON CONFLICT(community_id, profile_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at,
          resolved_at = NULL, resolved_by_profile_id = NULL
        WHERE community_membership_requests.status <> 'pending'`)
        .bind(communityId, actor.id, now).run();
    }
    return { joined: false, pending: true };
  }
  await database.batch([
    database.prepare(`INSERT INTO community_memberships
      (community_id, profile_id, role, status, joined_at) VALUES (?, ?, 'member', 'active', ?)`)
      .bind(communityId, actor.id, now),
    database.prepare(`INSERT INTO community_notification_preferences
      (community_id, profile_id, updated_at) VALUES (?, ?, ?)`)
      .bind(communityId, actor.id, now),
    database.prepare(`INSERT INTO community_audit_log
      (id, community_id, actor_profile_id, action, created_at) VALUES (?, ?, ?, 'member_joined', ?)`)
      .bind(crypto.randomUUID(), communityId, actor.id, now),
  ]);
  return { joined: true, pending: false };
}

export async function getD1CommunityMembershipState(database: D1Database, profileId: string, communityId: string) {
  const state = await database.prepare(`SELECT
    EXISTS(SELECT 1 FROM community_memberships WHERE community_id = ? AND profile_id = ? AND status IN ('active', 'muted')) AS joined,
    EXISTS(SELECT 1 FROM community_membership_requests WHERE community_id = ? AND profile_id = ? AND status = 'pending') AS pending`)
    .bind(communityId, profileId, communityId, profileId).first<{ joined: number; pending: number }>();
  if (!state) throw new Error("参加状態を確認できませんでした。");
  return { joined: Boolean(state.joined), pending: Boolean(state.pending) };
}

export async function cancelD1CommunityMembershipRequest(
  database: D1Database,
  actor: Profile,
  communityId: string,
  operationId: string,
) {
  if (!/^[A-Za-z0-9-]{16,80}$/.test(operationId)) {
    throw new Error("取消操作IDが不正です。");
  }
  const schema = await database.prepare("PRAGMA table_info(community_membership_requests)")
    .all<{ name: string }>();
  if (!(schema.results ?? []).some((column) => column.name === "resolution_operation_id")) {
    throw new Error("参加申請の取消準備が完了していません。運営側の更新完了後に再試行してください。");
  }
  const existing = await database.prepare(`SELECT action, target_profile_id AS targetProfileId,
      created_at AS createdAt FROM community_audit_log
    WHERE id = ? AND community_id = ? LIMIT 1`)
    .bind(operationId, communityId)
    .first<{ action: string; targetProfileId: string | null; createdAt: string }>();
  if (existing) {
    if (
      existing.action !== "membership_request_cancelled"
      || existing.targetProfileId !== actor.id
    ) {
      throw new Error("操作IDが別の操作で使用されています。");
    }
    return {
      pending: false,
      receipt: {
        auditId: operationId,
        action: existing.action,
        targetId: actor.id,
        targetLabel: "本人の参加申請",
        confirmedAt: existing.createdAt,
        replayed: true,
      },
    };
  }

  const now = new Date().toISOString();
  const result = await database.prepare(`UPDATE community_membership_requests
    SET status = 'cancelled', resolved_at = ?, resolved_by_profile_id = ?, resolution_operation_id = ?
    WHERE community_id = ? AND profile_id = ? AND status = 'pending'`)
    .bind(now, actor.id, operationId, communityId, actor.id)
    .run();
  /*
   * 「変わった行が1つ」で初回を判定していたが、実 D1 の meta.changes は trigger が入れた
   * 監査行も数える（0198 の trigger が1行足すので 2 になる）。初回の取消が毎回「再送」
   * （replayed: true）として返っていた（2026-09-08、3人の実セッションで発見）。
   * 隔離 SQLite の検査は trigger の行を数えないので通っていた。
   * 申請行は本人×コミュニティで1つしか無いので、「1つ以上変わった」で足りる。
   */
  if (Number(result.meta.changes ?? 0) < 1) {
    const replay = await database.prepare(`SELECT action, target_profile_id AS targetProfileId,
        created_at AS createdAt FROM community_audit_log
      WHERE id = ? AND community_id = ? LIMIT 1`)
      .bind(operationId, communityId)
      .first<{ action: string; targetProfileId: string | null; createdAt: string }>();
    if (replay?.action === "membership_request_cancelled" && replay.targetProfileId === actor.id) {
      return {
        pending: false,
        receipt: {
          auditId: operationId,
          action: replay.action,
          targetId: actor.id,
          targetLabel: "本人の参加申請",
          confirmedAt: replay.createdAt,
          replayed: true,
        },
      };
    }
    throw new Error("審査中の参加申請が見つかりません。");
  }
  return {
    pending: false,
    receipt: {
      auditId: operationId,
      action: "membership_request_cancelled",
      targetId: actor.id,
      targetLabel: "本人の参加申請",
      confirmedAt: now,
      replayed: false,
    },
  };
}

export class CommunityMemberManagementError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 422 | 503, readonly code?: string) {
    super(message);
  }
}

type ManagedCommunityMember = {
  role: "owner" | "moderator" | "member";
  status: "active" | "muted" | "banned";
};

export async function manageD1CommunityMember(
  database: D1Database,
  actor: Profile,
  input: {
    communityId: string;
    profileId: string;
    action: "promote" | "demote" | "mute" | "unmute" | "ban";
    operationId: string;
    note?: string;
  },
) {
  const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
  if (!input || !validId(input.communityId) || !validId(input.profileId)
    || typeof input.operationId !== "string" || !/^[A-Za-z0-9-]{16,80}$/.test(input.operationId)
    || !["promote", "demote", "mute", "unmute", "ban"].includes(input.action)
    || (input.note !== undefined && typeof input.note !== "string")) {
    throw new CommunityMemberManagementError("メンバー操作の指定が正しくありません。", 400);
  }
  const note = (input.note ?? "").normalize("NFKC").trim();
  if (note.length > 500) throw new CommunityMemberManagementError("判断理由は500文字以内で入力してください。", 400);
  try {
    const community = await database.prepare(`SELECT owner_profile_id AS ownerId, lifecycle_status AS status
      FROM communities WHERE id = ?`).bind(input.communityId).first<{ ownerId: string; status: string }>();
    if (!community) throw new CommunityMemberManagementError("コミュニティが見つかりません。", 404);
    const manager = await database.prepare(`SELECT role FROM community_memberships
      WHERE community_id = ? AND profile_id = ? AND status = 'active' AND role IN ('owner', 'moderator')
      AND NOT EXISTS(SELECT 1 FROM profile_moderation_status WHERE profile_id = ? AND status = 'suspended')`)
      .bind(input.communityId, actor.id, actor.id).first<{ role: "owner" | "moderator" }>();
    if (community.status !== "active" || !manager || (manager.role === "owner" && community.ownerId !== actor.id)) {
      throw new CommunityMemberManagementError("メンバーを管理する権限がありません。", 403);
    }
    const loadMember = () => database.prepare(`SELECT role, status FROM community_memberships
      WHERE community_id = ? AND profile_id = ?`).bind(input.communityId, input.profileId).first<ManagedCommunityMember>();
    const target = await loadMember();
    if (!target) throw new CommunityMemberManagementError("メンバーが見つかりません。", 404);
    if (input.profileId === actor.id || target.role === "owner" || input.profileId === community.ownerId) {
      throw new CommunityMemberManagementError("このメンバーには操作できません。", 403);
    }
    // 他 Hub の参加者は一般参加者に固定する（AGENTS.md: cross-Hub communities）。D1 のトリガーに任せると 503 になるので先に断る。
    if (input.action === "promote") {
      const targetProfile = await database.prepare("SELECT kind FROM profiles WHERE id = ?").bind(input.profileId).first<{ kind: string }>();
      if (targetProfile?.kind === "remote") {
        throw new CommunityMemberManagementError("他のHubから参加しているメンバーは、一般参加者のままです。モデレーターにはできません。", 422, "remote_member_role_fixed");
      }
    }
    if (manager.role === "moderator" && (target.role !== "member" || ["promote", "demote"].includes(input.action))) {
      throw new CommunityMemberManagementError("この操作を行う権限がありません。", 403);
    }
    type Audit = { id: string; communityId: string; actorId: string; targetId: string | null; action: string; detail: string; createdAt: string };
    const loadAudit = () => database.prepare(`SELECT id, community_id AS communityId, actor_profile_id AS actorId,
      target_profile_id AS targetId, action, detail, created_at AS createdAt FROM community_audit_log WHERE id = ?`)
      .bind(input.operationId).first<Audit>();
    const acknowledge = async (audit: Audit, replayed: boolean) => {
      let detail: { note?: unknown } | null;
      try { detail = JSON.parse(audit.detail); } catch { detail = null; }
      if (audit.communityId !== input.communityId || audit.actorId !== actor.id || audit.targetId !== input.profileId
        || audit.action !== `member_${input.action}` || !detail || detail.note !== note) {
        throw new CommunityMemberManagementError("操作IDが別の操作で使用されています。", 409);
      }
      const current = await loadMember();
      if (!current) throw new CommunityMemberManagementError("メンバーが見つかりません。", 404);
      return {
        profileId: input.profileId,
        ...current,
        receipt: { auditId: audit.id, action: audit.action, targetId: input.profileId, confirmedAt: audit.createdAt, replayed },
      };
    };
    const existing = await loadAudit();
    if (existing) return await acknowledge(existing, true);
    if (target.status === "banned") throw new CommunityMemberManagementError("除外済みのメンバーには操作できません。", 409);
    const role = input.action === "promote" ? "moderator" : input.action === "demote" ? "member" : target.role;
    const status = input.action === "mute" ? "muted" : input.action === "unmute" ? "active" : input.action === "ban" ? "banned" : target.status;
    if (role === target.role && status === target.status) {
      throw new CommunityMemberManagementError("メンバーの状態はすでに選択した内容です。", 409);
    }
    const now = new Date().toISOString();
    const detail = JSON.stringify({ note, targetId: input.profileId, before: target, after: { role, status }, nonce: crypto.randomUUID() });
    await database.batch([
      database.prepare(`UPDATE community_memberships SET role = ?, status = ?
        WHERE community_id = ? AND profile_id = ? AND role = ? AND status = ? AND status <> 'banned'
        AND profile_id <> ? AND role <> 'owner'
        AND NOT EXISTS(SELECT 1 FROM community_audit_log WHERE id = ?)
        AND EXISTS(SELECT 1 FROM communities c JOIN community_memberships manager ON manager.community_id = c.id
          WHERE c.id = community_memberships.community_id AND c.lifecycle_status = 'active' AND c.owner_profile_id = ?
          AND c.owner_profile_id <> community_memberships.profile_id
          AND manager.profile_id = ? AND manager.status = 'active' AND manager.role = ?
          AND ((manager.role = 'owner' AND c.owner_profile_id = manager.profile_id)
            OR (manager.role = 'moderator' AND community_memberships.role = 'member' AND ? IN ('mute', 'unmute', 'ban')))
          AND NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id = manager.profile_id AND moderation.status = 'suspended'))`)
        .bind(role, status, input.communityId, input.profileId, target.role, target.status, actor.id, input.operationId,
          community.ownerId, actor.id, manager.role, input.action),
      // changes() counts this UPDATE's rows, including when D1 meta.changes counts extra trigger writes.
      database.prepare(`INSERT INTO community_audit_log
        (id, community_id, actor_profile_id, target_profile_id, action, detail, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(input.operationId, input.communityId, actor.id, input.profileId, `member_${input.action}`, detail, now),
    ]);
    const saved = await loadAudit();
    if (!saved) throw new CommunityMemberManagementError("メンバーの状態や管理権限が変更されました。読み直して確認してください。", 409);
    return await acknowledge(saved, saved.detail !== detail);
  } catch (error) {
    if (error instanceof CommunityMemberManagementError) throw error;
    throw new CommunityMemberManagementError("保存結果を確認できませんでした。同じ内容で再試行してください。", 503);
  }
}

export type CommunityNotificationPreferences = {
  mentions: boolean;
  replies: boolean;
  guideUpdates: boolean;
  governance: boolean;
  membership: boolean;
};

export async function getD1CommunityNotificationPreferences(
  database: D1Database,
  actor: Profile,
  communityId: string,
): Promise<CommunityNotificationPreferences> {
  await requireD1ActiveCommunityMembership(database, actor.id, communityId);
  const row = await database.prepare(`SELECT mentions, replies, guide_updates, governance, membership
    FROM community_notification_preferences WHERE community_id = ? AND profile_id = ? LIMIT 1`)
    .bind(communityId, actor.id)
    .first<{ mentions: number; replies: number; guide_updates: number; governance: number; membership: number }>();
  return {
    mentions: row?.mentions !== 0,
    replies: row?.replies !== 0,
    guideUpdates: row?.guide_updates !== 0,
    governance: row?.governance !== 0,
    membership: row?.membership !== 0,
  };
}

export async function updateD1CommunityNotificationPreferences(
  database: D1Database,
  actor: Profile,
  communityId: string,
  preferences: CommunityNotificationPreferences,
) {
  await requireD1ActiveCommunityMembership(database, actor.id, communityId);
  await database.prepare(`INSERT INTO community_notification_preferences
    (community_id, profile_id, mentions, replies, guide_updates, governance, membership, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(community_id, profile_id) DO UPDATE SET
      mentions = excluded.mentions, replies = excluded.replies,
      guide_updates = excluded.guide_updates, governance = excluded.governance,
      membership = excluded.membership, updated_at = excluded.updated_at`)
    .bind(communityId, actor.id, Number(preferences.mentions), Number(preferences.replies), Number(preferences.guideUpdates), Number(preferences.governance), Number(preferences.membership), new Date().toISOString())
    .run();
  return preferences;
}
