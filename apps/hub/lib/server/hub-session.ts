import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";

export const HUB_SESSION_COOKIE = "hub.session";

type SessionProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  joined_at: string;
};

export class HubAuthenticationError extends Error {
  constructor(message = "Hub session is required.") {
    super(message);
    this.name = "HubAuthenticationError";
  }
}
export class HubSuspendedError extends HubAuthenticationError {
  profile: Profile;
  constructor(profile:Profile){super("このプロフィールは凍結されています。");this.name="HubSuspendedError";this.profile=profile;}
}
async function assertProfileActive(database:D1Database,profile:Profile){const row=await database.prepare("SELECT status FROM profile_moderation_status WHERE profile_id=? LIMIT 1").bind(profile.id).first<{status:string}>();if(row?.status==="suspended")throw new HubSuspendedError(profile);return profile;}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}

export async function hashHubSessionSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function profileFromSessionRow(row: SessionProfileRow): Profile {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined,
    joinedAt: row.joined_at,
    isCurrentUser: true
  };
}

/*
 * 開発中だけログインを省く。
 *
 * ログインは Google の本番経路しか無く、手元でそれを通すことはできない。
 * そのせいで設定・通知・メッセージなど13画面が一度も目で確認されないまま
 * 残っていた。開けない画面の欠陥は誰も見ない。
 *
 * 抜け道ではなく差し替えにしてある。ここが返すのは実在するプロフィールの行で、
 * 以降は通常と同じ経路（凍結の確認を含む）を通る。存在しないIDを指定しても
 * 誰にもならず、認証は通らない。
 *
 * 本番で開かないよう、独立した3条件すべてを要求する。1つでも欠けたら通常の
 * 認証に戻る。lib/hub-dev-session.test.ts がこの3条件を固定している。
 *   1. 本番ビルドでない
 *   2. 明示的にプロフィールIDを指定している（既定では未設定。
 *      .env.development.local で入れる）
 *   3. Workers で動いていない（Hubの本番はWorkers）
 */
export function hubDevSessionProfileId(): string | null {
  const configured = process.env.HUB_DEV_SESSION_PROFILE_ID?.trim();
  const enabled = process.env.NODE_ENV !== "production"
    && Boolean(configured)
    && process.env.CLOUDFLARE_RUNTIME !== "workers";
  return enabled && configured ? configured : null;
}

async function devSessionProfile(database: D1Database): Promise<Profile | null> {
  const profileId = hubDevSessionProfileId();
  if (!profileId) return null;

  const row = await database
    .prepare(`SELECT id, handle, display_name, bio, avatar_url, joined_at
      FROM profiles WHERE id = ? AND kind = 'local' LIMIT 1`)
    .bind(profileId)
    .first<SessionProfileRow>();

  return row ? profileFromSessionRow(row) : null;
}

export async function requireHubSessionProfile(
  request: Request,
  database: D1Database = getHubD1()
): Promise<Profile> {
  const secret = readCookie(request.headers.get("cookie"), HUB_SESSION_COOKIE);
  if (!secret || secret.length < 32 || secret.length > 512) {
    const development = await devSessionProfile(database);
    if (development) return assertProfileActive(database, development);
    throw new HubAuthenticationError();
  }

  const secretHash = await hashHubSessionSecret(secret);
  const now = new Date().toISOString();
  const row = await database
    .prepare(`SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url, p.joined_at
      FROM sessions s
      JOIN profiles p ON p.id = s.profile_id
      WHERE s.secret_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      LIMIT 1`)
    .bind(secretHash, now)
    .first<SessionProfileRow>();

  if (row) return assertProfileActive(database, profileFromSessionRow(row));

  const development = await devSessionProfile(database);
  if (development) return assertProfileActive(database, development);

  throw new HubAuthenticationError();
}

export async function getOptionalHubSessionProfile(
  request: Request,
  database: D1Database = getHubD1()
): Promise<Profile | null> {
  try {
    return await requireHubSessionProfile(request, database);
  } catch (error) {
    if (error instanceof HubAuthenticationError) return null;
    throw error;
  }
}
