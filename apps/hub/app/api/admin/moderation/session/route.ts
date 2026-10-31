import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  createModerationAdminLoginResponse,
  createModerationAdminLogoutResponse,
  createModerationAdminSessionResponse,
  hashModerationRecoveryCode,
  isModerationAdminKey,
  moderationAdminCookieValue,
  moderationAdminTokenSession,
  rememberRevokedModerationSession,
  requireSameOrigin
} from "@/lib/server/moderation-admin-auth";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import {
  adminLoginClientKey,
  adminLoginRetryAfterSeconds,
  recordAdminLoginFailure,
  revokeAdminSession
} from "@/lib/server/security-throttle";

async function attemptLogin(request: Request, body: { key?: unknown; totp?: unknown; recoveryCode?: unknown }): Promise<NextResponse> {
  if (typeof body.totp === "string" && body.totp.length > 0) {
    return createModerationAdminLoginResponse(request, body.key, body.totp);
  }
  if (!isModerationAdminKey(body.key) || typeof body.recoveryCode !== "string") {
    return NextResponse.json({ error: "管理キーまたは復旧コードが正しくありません。" }, { status: 403 });
  }
  const codeHash = hashModerationRecoveryCode(body.recoveryCode);
  const database = getOptionalHubD1();
  if (!codeHash || !database) return NextResponse.json({ error: "復旧コードを確認できません。" }, { status: 503 });
  const result = await database.prepare(
    "UPDATE hub_admin_mfa_recovery_codes SET used_at=?, used_audit_id=? WHERE code_hash=? AND used_at IS NULL",
  )
    .bind(new Date().toISOString(), randomUUID(), codeHash).run();
  if ((result.meta.changes ?? 0) !== 1) return NextResponse.json({ error: "復旧コードが正しくないか、使用済みです。" }, { status: 403 });
  return createModerationAdminSessionResponse(request);
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await request.json().catch(() => null) as { key?: unknown; totp?: unknown; recoveryCode?: unknown } | null;
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  // Failed-login throttle: 5 failures per 15 minutes per hashed client key. Fails closed in production.
  const database = getOptionalHubD1();
  let clientKey: string | null = null;
  if (database) {
    clientKey = await adminLoginClientKey(request);
    const retryAfter = await adminLoginRetryAfterSeconds(database, clientKey).catch(() => -1);
    if (retryAfter < 0) return NextResponse.json({ error: "ログインを確認できません。" }, { status: 503 });
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: "試行回数が多すぎます。しばらくしてからやり直してください。" },
        { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "ログインを確認できません。" }, { status: 503 });
  }

  const response = await attemptLogin(request, body);
  if (response.status === 403 && database && clientKey) {
    await recordAdminLoginFailure(database, clientKey).catch(() => undefined);
  }
  return response;
}

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const logout = createModerationAdminLogoutResponse(request);
  const session = moderationAdminTokenSession(moderationAdminCookieValue(request.headers.get("cookie")));
  if (!session) return logout;
  // Deny-list the session id until its own expiry so a copied cookie stops working.
  rememberRevokedModerationSession(session.jti, session.expiresAtMs);
  const database = getOptionalHubD1();
  try {
    if (!database) throw new Error("no database");
    await revokeAdminSession(database, session.jti, session.expiresAtMs);
  } catch {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(JSON.stringify({ authenticated: false, error: "セッションの失効を記録できませんでした。" }), {
        status: 503,
        headers: logout.headers,
      });
    }
  }
  return logout;
}
