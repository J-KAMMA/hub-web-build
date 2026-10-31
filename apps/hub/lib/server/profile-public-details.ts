import type { D1Database } from "@cloudflare/workers-types";

import type { ProfileExternalLink } from "@/lib/profile-external-links";

const mockLinks = new Map<string, ProfileExternalLink[]>();
const mockCommunityVisibility = new Set<string>();
const mockControls = new Map<string, { muted: boolean; blocked: boolean }>();

const communityKey = (profileId: string, communityId: string) => `${profileId}:${communityId}`;
const controlKey = (ownerProfileId: string, targetProfileId: string) => `${ownerProfileId}:${targetProfileId}`;

export function getMockProfileLinks(profileId: string) { return mockLinks.get(profileId) ?? []; }
export function setMockProfileLinks(profileId: string, links: ProfileExternalLink[]) { mockLinks.set(profileId, links); return links; }
export function isMockCommunityPublic(profileId: string, communityId: string) { return mockCommunityVisibility.has(communityKey(profileId, communityId)); }
export function setMockCommunityPublic(profileId: string, communityId: string, published: boolean) {
  const key = communityKey(profileId, communityId);
  if (published) mockCommunityVisibility.add(key); else mockCommunityVisibility.delete(key);
  return published;
}
export function getMockProfileControl(ownerProfileId: string, targetProfileId: string) {
  return mockControls.get(controlKey(ownerProfileId, targetProfileId)) ?? { muted: false, blocked: false };
}
export function setMockProfileControl(ownerProfileId: string, targetProfileId: string, action: "mute" | "block", enabled: boolean) {
  const key = controlKey(ownerProfileId, targetProfileId);
  const current = getMockProfileControl(ownerProfileId, targetProfileId);
  const next = action === "mute"
    ? { ...current, muted: enabled }
    : { muted: enabled ? true : current.muted, blocked: enabled };
  mockControls.set(key, next);
  return next;
}

export async function replaceD1ProfileLinks(database: D1Database, profileId: string, links: ProfileExternalLink[]) {
  const now = new Date().toISOString();
  await database.batch([
    database.prepare("DELETE FROM profile_external_links WHERE profile_id = ?").bind(profileId),
    ...links.map((link, position) => database.prepare(`INSERT INTO profile_external_links
      (id, profile_id, label, url, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), profileId, link.label, link.url, position, now, now)),
  ]);
  return links;
}

export async function setD1CommunityProfileVisibility(database: D1Database, profileId: string, communityId: string, published: boolean) {
  const result = await database.prepare(`UPDATE community_memberships SET profile_visibility = ?
    WHERE profile_id = ? AND community_id = ?`).bind(published ? "public" : "private", profileId, communityId).run();
  if (!result.meta.changes) throw new Error("参加しているコミュニティだけを公開できます。");
  return published;
}

export async function setD1ProfileControl(database: D1Database, ownerProfileId: string, targetProfileId: string, action: "mute" | "block", enabled: boolean) {
  if (ownerProfileId === targetProfileId) throw new Error("自分自身は操作できません。");
  const target = await database.prepare("SELECT id FROM profiles WHERE id = ? LIMIT 1").bind(targetProfileId).first();
  if (!target) throw new Error("プロフィールが見つかりません。");
  const now = new Date().toISOString();
  const muted = action === "mute" ? (enabled ? 1 : 0) : (enabled ? 1 : 0);
  const blocked = action === "block" && enabled ? 1 : 0;
  if (action === "mute") {
    await database.prepare(`INSERT INTO thread_user_controls (owner_profile_id, target_profile_id, muted, blocked, updated_at)
      VALUES (?, ?, ?, 0, ?) ON CONFLICT(owner_profile_id, target_profile_id) DO UPDATE SET muted = excluded.muted, updated_at = excluded.updated_at`)
      .bind(ownerProfileId, targetProfileId, muted, now).run();
  } else {
    const statements = [database.prepare(`INSERT INTO thread_user_controls (owner_profile_id, target_profile_id, muted, blocked, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_profile_id, target_profile_id) DO UPDATE SET
      blocked = excluded.blocked, muted = CASE WHEN excluded.blocked = 1 THEN 1 ELSE muted END, updated_at = excluded.updated_at`)
      .bind(ownerProfileId, targetProfileId, muted, blocked, now)];
    if (enabled) {
      statements.push(database.prepare(`DELETE FROM follows WHERE
        (follower_profile_id = ? AND followed_profile_id = ?)
        OR (follower_profile_id = ? AND followed_profile_id = ?)`)
        .bind(ownerProfileId, targetProfileId, targetProfileId, ownerProfileId));
      statements.push(database.prepare(`DELETE FROM list_profiles WHERE
        (profile_id = ? AND list_id IN (SELECT id FROM user_lists WHERE owner_profile_id = ?))
        OR (profile_id = ? AND list_id IN (SELECT id FROM user_lists WHERE owner_profile_id = ?))`)
        .bind(targetProfileId, ownerProfileId, ownerProfileId, targetProfileId));
      statements.push(database.prepare(`DELETE FROM notifications WHERE
        (receiver_profile_id = ? AND actor_profile_id = ?)
        OR (receiver_profile_id = ? AND actor_profile_id = ?)`)
        .bind(ownerProfileId, targetProfileId, targetProfileId, ownerProfileId));
      statements.push(database.prepare(`UPDATE thread_notification_events
        SET status = 'skipped', delivered_at = ?
        WHERE status = 'pending' AND (
          (receiver_profile_id = ? AND post_id IN (
            SELECT id FROM thread_posts WHERE author_profile_id = ?
          ))
          OR
          (receiver_profile_id = ? AND post_id IN (
            SELECT id FROM thread_posts WHERE author_profile_id = ?
          ))
        )`)
        .bind(now, ownerProfileId, targetProfileId, targetProfileId, ownerProfileId));
    }
    await database.batch(statements);
  }
  const row = await database.prepare(`SELECT muted, blocked FROM thread_user_controls
    WHERE owner_profile_id = ? AND target_profile_id = ?`).bind(ownerProfileId, targetProfileId).first<{ muted: number; blocked: number }>();
  return { muted: Boolean(row?.muted), blocked: Boolean(row?.blocked) };
}

export async function listD1ProfileControls(database: D1Database, ownerProfileId: string) {
  const rows = await database.prepare(`SELECT
      control.target_profile_id AS profileId,
      control.muted,
      control.blocked,
      control.updated_at AS updatedAt,
      profile.handle,
      profile.display_name AS displayName,
      profile.avatar_url AS avatarUrl
    FROM thread_user_controls control
    JOIN profiles profile ON profile.id = control.target_profile_id
    WHERE control.owner_profile_id = ? AND (control.muted = 1 OR control.blocked = 1)
    ORDER BY control.blocked DESC, control.updated_at DESC
    LIMIT 200`).bind(ownerProfileId).all<{
      profileId: string; muted: number; blocked: number; updatedAt: string;
      handle: string; displayName: string; avatarUrl: string | null;
    }>();
  return rows.results.map((row) => ({
    profileId: row.profileId,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    muted: Boolean(row.muted),
    blocked: Boolean(row.blocked),
    updatedAt: row.updatedAt,
  }));
}

export async function reportD1Profile(database: D1Database, reporterProfileId: string, targetProfileId: string, reason: string, details: string) {
  if (reporterProfileId === targetProfileId) throw new Error("自分自身は通報できません。");
  const allowed = new Set(["harassment", "spam", "impersonation", "privacy", "other"]);
  if (!allowed.has(reason) || details.length > 500) throw new Error("通報内容を確認してください。");
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO profile_reports
    (id, target_profile_id, reporter_profile_id, reason, details, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
    ON CONFLICT(target_profile_id, reporter_profile_id) DO UPDATE SET
      reason = excluded.reason, details = excluded.details, status = 'open', updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), targetProfileId, reporterProfileId, reason, details, now, now).run();
}

export type ProfileControlKind = "blocked" | "muted";

export type ProfileControlEntry = {
  profileId: string;
  handle: string;
  /** 他のハブの人なら host。同じハブの人は null。 */
  host: string | null;
  /** 見せる名前。他のハブの人は user@host、同じハブの人は handle。 */
  acct: string;
  displayName: string;
  avatarUrl: string | null;
  updatedAt: string;
};

export const PROFILE_CONTROL_PAGE_SIZE = 20;

function encodeControlCursor(updatedAt: string, profileId: string) {
  return Buffer.from(JSON.stringify([updatedAt, profileId]), "utf8").toString("base64url");
}

function decodeControlCursor(value: string | null | undefined): [string, string] | null {
  if (!value || value.length > 300) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [at, id] = parsed;
    return typeof at === "string" && typeof id === "string" && at && id ? [at, id] : null;
  } catch {
    return null;
  }
}

/*
 * 自分がブロック／ミュートした相手の一覧。呼んだ本人の行だけを返す
 * （owner_profile_id = 本人。ほかの人の一覧を引く口は無い）。
 * ミュートの一覧には、ブロック中の人を入れない（ブロックは一覧が別、
 * かつブロックはミュートも兼ねるため）。他のハブの人は影プロフィールで、
 * remote_actor_profiles から host を引いて handle@host で見せる。
 */
export async function listD1ProfileControlPage(
  database: D1Database,
  ownerProfileId: string,
  kind: ProfileControlKind,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ entries: ProfileControlEntry[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, Math.trunc(options.limit ?? PROFILE_CONTROL_PAGE_SIZE)));
  const cursor = decodeControlCursor(options.cursor);
  const scope = kind === "blocked" ? "control.blocked = 1" : "control.muted = 1 AND control.blocked = 0";
  const cursorScope = cursor ? "AND (control.updated_at < ? OR (control.updated_at = ? AND control.target_profile_id < ?))" : "";
  const bindings: string[] = [ownerProfileId];
  if (cursor) bindings.push(cursor[0], cursor[0], cursor[1]);
  const rows = await database.prepare(`SELECT
      control.target_profile_id AS profileId,
      control.updated_at AS updatedAt,
      profile.handle,
      profile.display_name AS displayName,
      profile.avatar_url AS avatarUrl,
      remote.host AS host,
      remote.handle AS remoteHandle
    FROM thread_user_controls control
    JOIN profiles profile ON profile.id = control.target_profile_id
    LEFT JOIN remote_actor_profiles remote ON remote.profile_id = control.target_profile_id
    WHERE control.owner_profile_id = ? AND ${scope}
    ${cursorScope}
    ORDER BY control.updated_at DESC, control.target_profile_id DESC
    LIMIT ${limit + 1}`).bind(...bindings).all<{
      profileId: string; updatedAt: string; handle: string; displayName: string; avatarUrl: string | null; host: string | null; remoteHandle: string | null;
    }>();
  const hasMore = rows.results.length > limit;
  const page = hasMore ? rows.results.slice(0, limit) : rows.results;
  const last = page[page.length - 1];
  return {
    entries: page.map((row) => ({
      profileId: row.profileId,
      handle: row.handle,
      host: row.host,
      acct: row.host ? (row.remoteHandle?.includes("@") ? row.remoteHandle : `${row.remoteHandle ?? row.handle}@${row.host}`) : row.handle,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      updatedAt: row.updatedAt,
    })),
    nextCursor: hasMore && last ? encodeControlCursor(last.updatedAt, last.profileId) : null,
  };
}
