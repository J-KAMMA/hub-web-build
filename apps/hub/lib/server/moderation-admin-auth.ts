import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const MODERATION_ADMIN_COOKIE = "hub_moderation_admin";
const TOKEN_CONTEXT = "hub-moderation-admin-v2";
const MODERATION_ADMIN_SESSION_TTL_SECONDS = 30 * 60;

type ModerationAdminTokenPayload = {
  v: 2;
  iat: number;
  exp: number;
  jti: string;
};

function equalSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function configuredSecret(): string | null {
  const secret = process.env.HUB_MODERATION_ADMIN_KEY;
  return secret && secret.length >= 16 ? secret : null;
}

export function isModerationAdminKey(value: unknown): boolean {
  const secret = configuredSecret();
  return Boolean(secret && typeof value === "string" && equalSecret(value, secret));
}

export function hashModerationRecoveryCode(value: string): string | null {
  const secret = configuredSecret();
  if (!secret) return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}$/.test(normalized)) return null;
  return createHmac("sha256", secret).update(`hub-moderation-recovery-v1:${normalized}`).digest("hex");
}

function tokenFor(secret: string, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const payload: ModerationAdminTokenPayload = {
    v: 2,
    iat: issuedAt,
    exp: issuedAt + MODERATION_ADMIN_SESSION_TTL_SECONDS,
    jti: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${TOKEN_CONTEXT}.${encoded}`)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeBase32(value: string): Buffer | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  const output: number[] = [];
  for (const character of value.toUpperCase().replace(/=|\s|-/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, "0");
    while (bits.length >= 8) {
      output.push(Number.parseInt(bits.slice(0, 8), 2));
      bits = bits.slice(8);
    }
  }
  return output.length > 0 ? Buffer.from(output) : null;
}

export function verifyModerationTotp(code: unknown, now = Date.now()): boolean {
  const secret = process.env.HUB_MODERATION_TOTP_SECRET?.trim();
  if (!secret || typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const key = decodeBase32(secret);
  if (!key) return false;
  for (let drift = -1; drift <= 1; drift += 1) {
    const counter = Math.floor(now / 30_000) + drift;
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", key).update(bytes).digest();
    const offset = digest[digest.length - 1] & 15;
    const binary = ((digest[offset] & 127) << 24)
      | ((digest[offset + 1] & 255) << 16)
      | ((digest[offset + 2] & 255) << 8)
      | (digest[offset + 3] & 255);
    const expected = String(binary % 1_000_000).padStart(6, "0");
    if (equalSecret(code, expected)) return true;
  }
  return false;
}

/*
 * Logout revocation. The durable deny list lives in D1 (hub_admin_session_denylist) and is enforced for
 * every /admin and /api/admin request by the Worker entry point (custom-worker.ts), because this
 * synchronous check cannot query D1. This in-memory set additionally makes revocation immediate inside
 * the isolate that handled the logout (and in local development).
 */
const revokedSessionIds = new Map<string, number>();

export function rememberRevokedModerationSession(jti: string, expiresAtMs: number, now = Date.now()): void {
  for (const [id, expiry] of revokedSessionIds) if (expiry < now) revokedSessionIds.delete(id);
  revokedSessionIds.set(jti, expiresAtMs);
}

/** The jti and expiry (ms) of a correctly signed, unexpired admin token; null otherwise. */
export function moderationAdminTokenSession(token: string | undefined, now = Date.now()): { jti: string; expiresAtMs: number } | null {
  const secret = configuredSecret();
  if (!secret || !token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = createHmac("sha256", secret).update(`${TOKEN_CONTEXT}.${parts[0]}`).digest("base64url");
  if (!equalSecret(parts[1], expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<ModerationAdminTokenPayload>;
    if (typeof payload.jti !== "string" || typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    return { jti: payload.jti, expiresAtMs: payload.exp * 1000 };
  } catch {
    return null;
  }
}

export function moderationAdminCookieValue(cookieHeader: string | null): string | undefined {
  return (cookieHeader ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${MODERATION_ADMIN_COOKIE}=`))?.slice(MODERATION_ADMIN_COOKIE.length + 1);
}

/*
 * 開発中だけ管理画面のログインを省く。
 *
 * ローカルには HUB_MODERATION_ADMIN_KEY を置いていないので configuredSecret() は
 * null になり、そもそもログインが成立しない（セッション発行が503）。管理画面を
 * 目で確認するたびに鍵とTOTPを用意するのは現実的でないため、開発時に限って開ける。
 *
 * 本番で開かないよう、独立した3条件すべてを要求する。1つでも欠けたら通常の
 * 認証に戻る。lib/moderation-dev-bypass.test.ts がこの3条件を固定している。
 *   1. 本番ビルドでない
 *   2. 明示的に有効化している（既定では無効。.env.development.local で入れる）
 *   3. Workers で動いていない（Hubの本番はWorkers）
 */
export function moderationDevBypassEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.HUB_MODERATION_DEV_BYPASS === "1"
    && process.env.CLOUDFLARE_RUNTIME !== "workers";
}

export function isModerationAdminToken(
  token: string | undefined,
  now = Date.now(),
): boolean {
  if (moderationDevBypassEnabled()) return true;
  const secret = configuredSecret();
  if (!secret || !token || token.length > 1024) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const expectedSignature = createHmac("sha256", secret)
    .update(`${TOKEN_CONTEXT}.${parts[0]}`)
    .digest("base64url");
  if (!equalSecret(parts[1], expectedSignature)) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Partial<ModerationAdminTokenPayload>;
    const nowSeconds = Math.floor(now / 1000);
    const issuedAt = payload.iat;
    const expiresAt = payload.exp;
    return payload.v === 2
      && typeof issuedAt === "number"
      && Number.isInteger(issuedAt)
      && typeof expiresAt === "number"
      && Number.isInteger(expiresAt)
      && typeof payload.jti === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.jti)
      && expiresAt === issuedAt + MODERATION_ADMIN_SESSION_TTL_SECONDS
      && issuedAt <= nowSeconds + 60
      && expiresAt > nowSeconds
      && !revokedSessionIds.has(payload.jti);
  } catch {
    return false;
  }
}

export function requireModerationAdmin(request: Request): NextResponse | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${MODERATION_ADMIN_COOKIE}=`))?.slice(MODERATION_ADMIN_COOKIE.length + 1);
  if (!isModerationAdminToken(token)) {
    return NextResponse.json({ error: "モデレーション管理者の認証が必要です。" }, { status: 403 });
  }
  return null;
}

export function requireSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  let originUrl: URL | null = null;
  try { originUrl = origin ? new URL(origin) : null; } catch { originUrl = null; }
  const allowedHosts = new Set([
    requestUrl.host,
    request.headers.get("host"),
    request.headers.get("x-forwarded-host")
  ].filter((value): value is string => Boolean(value)));
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const allowedProtocols = new Set([requestUrl.protocol, forwardedProtocol ? `${forwardedProtocol}:` : null].filter((value): value is string => Boolean(value)));
  if (!originUrl || !allowedHosts.has(originUrl.host) || !allowedProtocols.has(originUrl.protocol)) {
    return NextResponse.json({ error: "リクエスト元を確認できません。" }, { status: 403 });
  }
  return null;
}

export function createModerationAdminLoginResponse(request: Request, submittedKey: unknown, submittedTotp?: unknown): NextResponse {
  if (!isModerationAdminKey(submittedKey) || !verifyModerationTotp(submittedTotp)) {
    return NextResponse.json({ error: "管理キーが正しくありません。" }, { status: 403 });
  }
  return createModerationAdminSessionResponse(request);
}

export function createModerationAdminSessionResponse(request: Request): NextResponse {
  const secret = configuredSecret();
  if (!secret) return NextResponse.json({ error: "管理認証が設定されていません。" }, { status: 503 });
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(MODERATION_ADMIN_COOKIE, tokenFor(secret), {
    httpOnly: true,
    maxAge: MODERATION_ADMIN_SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:"
  });
  return response;
}

export function createModerationAdminLogoutResponse(request: Request): NextResponse {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(MODERATION_ADMIN_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:"
  });
  return response;
}
