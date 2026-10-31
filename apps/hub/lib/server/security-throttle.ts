import type { D1Database } from "@cloudflare/workers-types";

import { clientIpFromRequest, keyedDailyHash } from "@/lib/ip-hash";

/** Fixed-window quota. Returns false when `bucketKey` is already at `limit` in the current window. */
export async function consumeWindowQuota(
  database: D1Database,
  scope: string,
  bucketKey: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const result = await database.prepare(`INSERT INTO hub_security_rate_counters (scope, bucket_key, window_start, count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(scope, bucket_key, window_start) DO UPDATE SET count = count + 1
      WHERE count < ?`)
    .bind(scope, bucketKey, windowStart, limit).run();
  if (!result.meta.changes) return false;
  await database.prepare("DELETE FROM hub_security_rate_counters WHERE scope = ? AND window_start < ?")
    .bind(scope, windowStart - windowMs).run().catch(() => undefined);
  return true;
}

export const ADMIN_LOGIN_MAX_FAILURES = 5;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Hashed client key from CF-Connecting-IP only. The raw address is never stored. */
export async function adminLoginClientKey(request: Request): Promise<string> {
  return keyedDailyHash("admin-login", clientIpFromRequest(request.headers));
}

/** Seconds until another attempt is allowed, or 0 when sign-in may proceed. */
export async function adminLoginRetryAfterSeconds(
  database: D1Database,
  keyHash: string,
  now = Date.now(),
): Promise<number> {
  const rows = await database.prepare(
    "SELECT failed_at FROM hub_admin_login_failures WHERE key_hash = ? AND failed_at > ? ORDER BY failed_at DESC LIMIT ?",
  ).bind(keyHash, now - ADMIN_LOGIN_WINDOW_MS, ADMIN_LOGIN_MAX_FAILURES).all<{ failed_at: number }>();
  const failures = rows.results ?? [];
  if (failures.length < ADMIN_LOGIN_MAX_FAILURES) return 0;
  const oldestCounted = failures[failures.length - 1]!.failed_at;
  return Math.max(1, Math.ceil((oldestCounted + ADMIN_LOGIN_WINDOW_MS - now) / 1000));
}

export async function recordAdminLoginFailure(database: D1Database, keyHash: string, now = Date.now()): Promise<void> {
  await database.prepare("INSERT INTO hub_admin_login_failures (key_hash, failed_at) VALUES (?, ?)")
    .bind(keyHash, now).run();
  await database.prepare("DELETE FROM hub_admin_login_failures WHERE failed_at < ?")
    .bind(now - ADMIN_LOGIN_RETENTION_MS).run().catch(() => undefined);
}

export async function revokeAdminSession(database: D1Database, jti: string, expiresAtMs: number, now = Date.now()): Promise<void> {
  await database.prepare("INSERT OR IGNORE INTO hub_admin_session_denylist (jti, expires_at) VALUES (?, ?)")
    .bind(jti, expiresAtMs).run();
  await database.prepare("DELETE FROM hub_admin_session_denylist WHERE expires_at < ?")
    .bind(now).run().catch(() => undefined);
}

export async function isAdminSessionRevoked(database: D1Database, jti: string): Promise<boolean> {
  const row = await database.prepare("SELECT jti FROM hub_admin_session_denylist WHERE jti = ?").bind(jti).first();
  return Boolean(row);
}
