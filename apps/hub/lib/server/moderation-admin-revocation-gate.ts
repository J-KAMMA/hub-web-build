import type { D1Database } from "@cloudflare/workers-types";

import { moderationAdminCookieValue, moderationAdminTokenSession } from "@/lib/server/moderation-admin-auth";
import { isAdminSessionRevoked } from "@/lib/server/security-throttle";

const SESSION_PATH = "/api/admin/moderation/session";

export function isModerationAdminSurface(pathname: string): boolean {
  return (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/"))
    && pathname !== SESSION_PATH;
}

/**
 * Worker-entry check for the logout deny list. The synchronous per-route admin check cannot read D1,
 * so every admin page and admin API request passes here first. Returns a refusal Response when the
 * presented admin cookie was revoked by logout (or the deny list cannot be read), else null.
 */
export async function refuseRevokedModerationSession(
  pathname: string,
  cookieHeader: string | null,
  database: D1Database | undefined,
): Promise<Response | null> {
  if (!isModerationAdminSurface(pathname)) return null;
  const session = moderationAdminTokenSession(moderationAdminCookieValue(cookieHeader));
  if (!session) return null; // no valid cookie: the route's own check refuses
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    if (!database) throw new Error("no database");
    if (await isAdminSessionRevoked(database, session.jti)) {
      return new Response(JSON.stringify({ error: "モデレーション管理者の認証が必要です。" }), { status: 403, headers });
    }
  } catch {
    return new Response(JSON.stringify({ error: "管理セッションを確認できません。" }), { status: 503, headers });
  }
  return null;
}
