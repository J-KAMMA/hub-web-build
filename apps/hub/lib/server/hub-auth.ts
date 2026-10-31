import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { hashHubSessionSecret } from "@/lib/server/hub-session";

const PASSWORD_ITERATIONS = 210_000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const DUMMY_SALT = "AAAAAAAAAAAAAAAAAAAAAA";

type CredentialRow = {
  profile_id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  joined_at: string;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
};

export class HubAuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubAuthInputError";
  }
}

export class HubInvalidCredentialsError extends Error {
  constructor() {
    super("Invalid Hub credentials.");
    this.name = "HubInvalidCredentialsError";
  }
}

export class HubHandleConflictError extends Error {
  constructor() {
    super("Hub handle is already in use.");
    this.name = "HubHandleConflictError";
  }
}

function normalizeHandle(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function validateHandle(value: string): string {
  const handle = normalizeHandle(value);
  if (!/^[a-z0-9_]{3,32}$/u.test(handle)) {
    throw new HubAuthInputError("ユーザーIDは3〜32文字の半角英数字と_を使用してください。");
  }
  return handle;
}

function validateDisplayName(value: string): string {
  const displayName = value.normalize("NFKC").trim();
  if (displayName.length < 1 || displayName.length > 80) {
    throw new HubAuthInputError("表示名は1〜80文字で入力してください。");
  }
  return displayName;
}

function validatePassword(value: string): string {
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (value.length < 12 || byteLength > 256) {
    throw new HubAuthInputError("パスワードは12文字以上、256バイト以内で入力してください。");
  }
  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function derivePasswordHash(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(salt), iterations },
    key,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;

  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: ArrayBufferView, right: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(leftBytes, rightBytes);
  }

  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function profileFromCredential(row: CredentialRow): Profile {
  return {
    id: row.profile_id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined,
    joinedAt: row.joined_at,
    isCurrentUser: true
  };
}

export async function createHubSession(secret?: string) {
  const sessionSecret = secret ?? randomToken(32);
  const createdAt = new Date();
  return {
    id: crypto.randomUUID(),
    secret: sessionSecret,
    secretHash: await hashHubSessionSecret(sessionSecret),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + SESSION_LIFETIME_MS).toISOString()
  };
}

export async function createHubAccount(
  database: D1Database,
  input: { handle: string; displayName: string; password: string }
): Promise<{ profile: Profile; sessionSecret: string; expiresAt: string }> {
  const handle = validateHandle(input.handle);
  const displayName = validateDisplayName(input.displayName);
  const password = validatePassword(input.password);
  const existing = await database.prepare("SELECT id FROM profiles WHERE handle = ? COLLATE NOCASE LIMIT 1")
    .bind(handle).first<{ id: string }>();
  if (existing) throw new HubHandleConflictError();

  const now = new Date().toISOString();
  const profileId = crypto.randomUUID();
  const salt = randomToken(16);
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  const session = await createHubSession();

  try {
    await database.batch([
      database.prepare(`INSERT INTO profiles (
        id, handle, display_name, bio, avatar_url, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, '', NULL, ?, ?, ?)`)
        .bind(profileId, handle, displayName, now, now, now),
      database.prepare(`INSERT INTO profile_credentials (
        profile_id, password_salt, password_hash, password_iterations, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(profileId, salt, passwordHash, PASSWORD_ITERATIONS, now, now),
      database.prepare(`INSERT INTO sessions (
        id, profile_id, secret_hash, created_at, last_seen_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)`)
        .bind(session.id, profileId, session.secretHash, session.createdAt, session.createdAt, session.expiresAt)
    ]);
  } catch (error) {
    if (error instanceof Error && /unique|profiles\.handle/i.test(error.message)) {
      throw new HubHandleConflictError();
    }
    throw error;
  }

  return {
    profile: { id: profileId, handle, displayName, bio: "", joinedAt: now, isCurrentUser: true },
    sessionSecret: session.secret,
    expiresAt: session.expiresAt
  };
}

export async function loginHubAccount(
  database: D1Database,
  input: { handle: string; password: string }
): Promise<{ profile: Profile; sessionSecret: string; expiresAt: string }> {
  const handle = validateHandle(input.handle);
  const password = validatePassword(input.password);
  const row = await database.prepare(`SELECT
      p.id AS profile_id, p.handle, p.display_name, p.bio, p.avatar_url, p.joined_at,
      c.password_salt, c.password_hash, c.password_iterations
    FROM profiles p
    JOIN profile_credentials c ON c.profile_id = p.id
    WHERE p.handle = ? COLLATE NOCASE
    LIMIT 1`)
    .bind(handle)
    .first<CredentialRow>();

  const candidateHash = await derivePasswordHash(
    password,
    row?.password_salt ?? DUMMY_SALT,
    row?.password_iterations ?? PASSWORD_ITERATIONS
  );
  if (!row || !constantTimeEqual(candidateHash, row.password_hash)) {
    throw new HubInvalidCredentialsError();
  }

  const session = await createHubSession();
  await database.batch([
    database.prepare("DELETE FROM sessions WHERE profile_id = ? AND (revoked_at IS NOT NULL OR expires_at <= ?)")
      .bind(row.profile_id, session.createdAt),
    database.prepare(`INSERT INTO sessions (
      id, profile_id, secret_hash, created_at, last_seen_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL)`)
      .bind(session.id, row.profile_id, session.secretHash, session.createdAt, session.createdAt, session.expiresAt)
  ]);

  return { profile: profileFromCredential(row), sessionSecret: session.secret, expiresAt: session.expiresAt };
}
