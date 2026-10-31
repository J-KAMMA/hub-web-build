import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { verifyDesktopSessionAssertion } from "@/lib/desktop-account-assertion";
import {
  HubAuthenticationError,
  HubSuspendedError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

export class DesktopHubAuthenticationError extends Error {
  constructor() { super("Desktop authentication failed."); this.name = "DesktopHubAuthenticationError"; }
}

type ProfileRow = {
  id: string; handle: string; display_name: string; bio: string; avatar_url: string | null;
  joined_at: string; moderation_status: string | null;
};

export async function getOptionalDesktopHubProfile(request: Request, database: D1Database): Promise<Profile | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const token = authorization.match(/^Bearer ([A-Za-z0-9_.-]{1,4096})$/)?.[1];
  if (!token) throw new DesktopHubAuthenticationError();
  const assertion = await verifyDesktopSessionAssertion(token, process.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? "");
  if (!assertion) throw new DesktopHubAuthenticationError();
  const replay = await database.prepare("SELECT assertion_jti FROM account_assertion_replays WHERE assertion_jti=?")
    .bind(assertion.jti).first();
  if (replay) throw new DesktopHubAuthenticationError();
  const row = await database.prepare(`SELECT p.id,p.handle,p.display_name,p.bio,p.avatar_url,p.joined_at,
      moderation.status AS moderation_status
    FROM desktop_account_profile_links desktop
    JOIN profiles p ON p.id=desktop.profile_id
    LEFT JOIN profile_moderation_status moderation ON moderation.profile_id=p.id
    WHERE desktop.desktop_pairwise_subject=? LIMIT 1`)
    .bind(assertion.sub).first<ProfileRow>();
  if (!row) throw new DesktopHubAuthenticationError();
  const now = new Date().toISOString();
  try {
    await database.batch([
      database.prepare("INSERT INTO account_assertion_replays VALUES (?,?,?)")
        .bind(assertion.jti, new Date(assertion.exp * 1000).toISOString(), now),
      database.prepare(`UPDATE desktop_account_profile_links SET last_used_at=?
        WHERE desktop_pairwise_subject=?`).bind(now, assertion.sub),
    ]);
  } catch { throw new DesktopHubAuthenticationError(); }
  const profile: Profile = { id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined, joinedAt: row.joined_at, isCurrentUser: true };
  if (row.moderation_status === "suspended") throw new HubSuspendedError(profile);
  return profile;
}

/**
 * クライアント向けの本人専用口。Bearer が無いなら無い、壊れていれば壊れた、
 * どちらも 401 でそろえる。省略可能な口（フィード）と違って、通知やDMを
 * 誰にも同じものを返す訳にはいかない。
 */
export async function requireDesktopHubProfile(request: Request, database: D1Database): Promise<Profile> {
  const profile = await getOptionalDesktopHubProfile(request, database);
  if (!profile) throw new DesktopHubAuthenticationError();
  return profile;
}

/**
 * カタログ系GETなど「本人として読むと個人化される面」で使うviewer解決。
 * Bearer（desktop端末の明示的な資格）があればそちらを先に見て、無いときだけ
 * Cookieセッション（開発フォールバック込み）に委ねる。どちらも駄目なら
 * HubAuthenticationError にそろえる——呼び出し側は session と同じく 401 へ。
 */
export async function requireHubViewerProfile(request: Request, database: D1Database): Promise<Profile> {
  if (request.headers.get("authorization")) {
    try {
      return await requireDesktopHubProfile(request, database);
    } catch (error) {
      if (error instanceof HubSuspendedError) throw error;
      throw new HubAuthenticationError();
    }
  }
  return requireHubSessionProfile(request, database);
}

export async function getOptionalHubViewerProfile(request: Request, database: D1Database): Promise<Profile | null> {
  try {
    return await requireHubViewerProfile(request, database);
  } catch (error) {
    if (error instanceof HubAuthenticationError) return null;
    throw error;
  }
}
