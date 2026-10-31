import "server-only";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON
} from "@simplewebauthn/server";
import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import { signupConsentStatement } from "@/lib/server/hub-consent-records";
import { createHubSession, HubAuthInputError, HubHandleConflictError } from "@/lib/server/hub-auth";
import { HUB_PASSKEY_CEREMONY_COOKIE } from "@/lib/server/hub-auth-route";
import { hashHubSessionSecret, readCookie } from "@/lib/server/hub-session";
import { getInstanceHost } from "@/lib/instance-origin";

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const RP_NAME = "Hub";

type PasskeyPurpose = "register" | "authenticate";

type ChallengeRow = {
  id: string;
  purpose: PasskeyPurpose;
  profile_id: string;
  handle: string;
  display_name: string | null;
  challenge: string;
  expires_at: string;
};

type PasskeyRow = {
  credential_id: string;
  profile_id: string;
  public_key: string;
  counter: number;
  transports_json: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  joined_at: string;
};

export class HubPasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubPasskeyError";
  }
}

function normalizeHandle(value: string): string {
  const handle = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9_]{3,32}$/u.test(handle)) {
    throw new HubAuthInputError("ユーザーIDは3〜32文字の半角英数字と_で入力してください。");
  }
  return handle;
}

function normalizeDisplayName(value: string): string {
  const displayName = value.normalize("NFKC").trim();
  if (displayName.length < 1 || displayName.length > 80) {
    throw new HubAuthInputError("表示名は1〜80文字で入力してください。");
  }
  return displayName;
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
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

function parseTransports(value: string): AuthenticatorTransportFuture[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is AuthenticatorTransportFuture =>
      typeof item === "string" && ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(item)
    ) : [];
  } catch {
    return [];
  }
}

export function getPasskeyRp(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || url.host;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":", 1)[0];
  if (hostname !== getInstanceHost().split(":", 1)[0] && hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new HubPasskeyError("このホストではパスキーを利用できません。");
  }
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProtocol || url.protocol.slice(0, -1);
  if (protocol !== "https" && !(protocol === "http" && (hostname === "localhost" || hostname === "127.0.0.1"))) {
    throw new HubPasskeyError("パスキーには安全な接続が必要です。");
  }
  return { rpID: hostname, origin: `${protocol}://${host}` };
}

async function createChallenge(
  database: D1Database,
  data: Omit<ChallengeRow, "id" | "challenge" | "expires_at"> & { challenge: string }
): Promise<{ cookieValue: string; expiresAt: string }> {
  const id = crypto.randomUUID();
  const secret = randomToken(32);
  const secretHash = await hashHubSessionSecret(secret);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_LIFETIME_MS).toISOString();
  await database.batch([
    database.prepare("DELETE FROM passkey_challenges WHERE expires_at <= ? OR consumed_at IS NOT NULL").bind(now.toISOString()),
    database.prepare(`INSERT INTO passkey_challenges (
      id, secret_hash, purpose, profile_id, handle, display_name, challenge, created_at, expires_at, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(
      id, secretHash, data.purpose, data.profile_id, data.handle, data.display_name, data.challenge, now.toISOString(), expiresAt
    )
  ]);
  return { cookieValue: `${id}.${secret}`, expiresAt };
}

async function readChallenge(database: D1Database, request: Request, purpose: PasskeyPurpose): Promise<ChallengeRow> {
  const cookie = readCookie(request.headers.get("cookie"), HUB_PASSKEY_CEREMONY_COOKIE);
  const separator = cookie?.indexOf(".") ?? -1;
  if (!cookie || separator < 1) throw new HubPasskeyError("パスキー操作の有効期限が切れました。もう一度お試しください。");
  const id = cookie.slice(0, separator);
  const secret = cookie.slice(separator + 1);
  const secretHash = await hashHubSessionSecret(secret);
  const row = await database.prepare(`SELECT id, purpose, profile_id, handle, display_name, challenge, expires_at
    FROM passkey_challenges
    WHERE id = ? AND secret_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
    LIMIT 1`).bind(id, secretHash, purpose, new Date().toISOString()).first<ChallengeRow>();
  if (!row) throw new HubPasskeyError("パスキー操作の有効期限が切れました。もう一度お試しください。");
  return row;
}

async function consumeChallenge(database: D1Database, id: string): Promise<void> {
  const result = await database.prepare("UPDATE passkey_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
    .bind(new Date().toISOString(), id).run();
  if ((result.meta.changes ?? 0) !== 1) throw new HubPasskeyError("このパスキー操作はすでに使用されています。");
}

function profileFromRow(row: PasskeyRow): Profile {
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

export async function beginPasskeyRegistration(database: D1Database, request: Request, input: {
  handle: string;
  displayName: string;
}) {
  const handle = normalizeHandle(input.handle);
  const displayName = normalizeDisplayName(input.displayName);
  const existing = await database.prepare("SELECT id FROM profiles WHERE handle = ? COLLATE NOCASE LIMIT 1")
    .bind(handle).first<{ id: string }>();
  if (existing) throw new HubHandleConflictError();
  const profileId = crypto.randomUUID();
  const { rpID } = getPasskeyRp(request);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(profileId),
    userName: handle,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257],
    timeout: CHALLENGE_LIFETIME_MS
  });
  const ceremony = await createChallenge(database, {
    purpose: "register", profile_id: profileId, handle, display_name: displayName, challenge: options.challenge
  });
  return { options, ...ceremony };
}

export async function finishPasskeyRegistration(database: D1Database, request: Request, response: RegistrationResponseJSON) {
  const challenge = await readChallenge(database, request, "register");
  const { rpID, origin } = getPasskeyRp(request);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: [-7, -257]
  }).catch(() => {
    throw new HubPasskeyError("パスキーを確認できませんでした。");
  });
  if (!verification.verified || !verification.registrationInfo) throw new HubPasskeyError("パスキーを確認できませんでした。");
  const existing = await database.prepare("SELECT id FROM profiles WHERE handle = ? COLLATE NOCASE LIMIT 1")
    .bind(challenge.handle).first<{ id: string }>();
  if (existing) throw new HubHandleConflictError();
  await consumeChallenge(database, challenge.id);

  const now = new Date().toISOString();
  const credential = verification.registrationInfo.credential;
  const session = await createHubSession();
  try {
    await database.batch([
      database.prepare(`INSERT INTO profiles (
        id, handle, display_name, bio, avatar_url, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, '', NULL, ?, ?, ?)`).bind(
        challenge.profile_id, challenge.handle, challenge.display_name ?? challenge.handle, now, now, now
      ),
      signupConsentStatement(database, challenge.profile_id, "passkey_signup", now),
      database.prepare(`INSERT INTO profile_passkeys (
        credential_id, profile_id, public_key, counter, transports_json, device_type, backed_up, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`).bind(
        credential.id,
        challenge.profile_id,
        bytesToBase64Url(credential.publicKey),
        credential.counter,
        JSON.stringify(response.response.transports ?? credential.transports ?? []),
        verification.registrationInfo.credentialDeviceType,
        verification.registrationInfo.credentialBackedUp ? 1 : 0,
        now
      ),
      database.prepare(`INSERT INTO sessions (
        id, profile_id, secret_hash, created_at, last_seen_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)`).bind(
        session.id, challenge.profile_id, session.secretHash, session.createdAt, session.createdAt, session.expiresAt
      )
    ]);
  } catch (error) {
    if (error instanceof Error && /unique|profiles\.handle/i.test(error.message)) throw new HubHandleConflictError();
    throw error;
  }
  return {
    profile: {
      id: challenge.profile_id,
      handle: challenge.handle,
      displayName: challenge.display_name ?? challenge.handle,
      bio: "",
      joinedAt: now,
      isCurrentUser: true
    } satisfies Profile,
    sessionSecret: session.secret,
    expiresAt: session.expiresAt
  };
}

export async function beginPasskeyAuthentication(database: D1Database, request: Request, input: { handle: string }) {
  const handle = normalizeHandle(input.handle);
  const profile = await database.prepare("SELECT id FROM profiles WHERE handle = ? COLLATE NOCASE LIMIT 1")
    .bind(handle).first<{ id: string }>();
  const profileId = profile?.id ?? crypto.randomUUID();
  const passkeys = profile
    ? await database.prepare(`SELECT credential_id, transports_json FROM profile_passkeys
        WHERE profile_id = ? ORDER BY created_at`).bind(profile.id).all<{ credential_id: string; transports_json: string }>()
    : { results: [] as { credential_id: string; transports_json: string }[] };
  // Unknown users receive an indistinguishable ceremony so this endpoint cannot
  // be used to enumerate registered Hub handles.
  const allowedCredentials = passkeys.results.length
    ? passkeys.results.map((passkey) => ({
        id: passkey.credential_id,
        transports: parseTransports(passkey.transports_json)
      }))
    : [{ id: randomToken(32), transports: [] as AuthenticatorTransportFuture[] }];
  const { rpID } = getPasskeyRp(request);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: allowedCredentials,
    userVerification: "required",
    timeout: CHALLENGE_LIFETIME_MS
  });
  const ceremony = await createChallenge(database, {
    purpose: "authenticate", profile_id: profileId, handle, display_name: null, challenge: options.challenge
  });
  return { options, ...ceremony };
}

export async function finishPasskeyAuthentication(database: D1Database, request: Request, response: AuthenticationResponseJSON) {
  const challenge = await readChallenge(database, request, "authenticate");
  const row = await database.prepare(`SELECT
      k.credential_id, k.profile_id, k.public_key, k.counter, k.transports_json,
      p.handle, p.display_name, p.bio, p.avatar_url, p.joined_at
    FROM profile_passkeys k JOIN profiles p ON p.id = k.profile_id
    WHERE k.credential_id = ? AND k.profile_id = ? LIMIT 1`)
    .bind(response.id, challenge.profile_id).first<PasskeyRow>();
  if (!row) throw new HubPasskeyError("パスキーを確認できませんでした。");
  const { rpID, origin } = getPasskeyRp(request);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: row.credential_id,
      publicKey: base64UrlToBytes(row.public_key),
      counter: row.counter,
      transports: parseTransports(row.transports_json)
    }
  }).catch(() => {
    throw new HubPasskeyError("パスキーを確認できませんでした。");
  });
  if (!verification.verified) throw new HubPasskeyError("パスキーを確認できませんでした。");
  await consumeChallenge(database, challenge.id);
  const session = await createHubSession();
  await database.batch([
    database.prepare("UPDATE profile_passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?")
      .bind(verification.authenticationInfo.newCounter, session.createdAt, row.credential_id),
    database.prepare(`INSERT INTO sessions (
      id, profile_id, secret_hash, created_at, last_seen_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL)`).bind(
      session.id, row.profile_id, session.secretHash, session.createdAt, session.createdAt, session.expiresAt
    )
  ]);
  return { profile: profileFromRow(row), sessionSecret: session.secret, expiresAt: session.expiresAt };
}
