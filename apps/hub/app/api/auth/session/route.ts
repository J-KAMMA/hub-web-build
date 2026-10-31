import { NextResponse } from "next/server";

import { localDevelopmentAutoLoginHandle } from "@/lib/local-development-auth";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin, setHubSessionCookie } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { HUB_SESSION_COOKIE, hashHubSessionSecret, readCookie } from "@/lib/server/hub-session";

const LOCAL_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

function localSessionSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json(
      { error: "セッションを確認できません。しばらくしてから再度お試しください。" },
      { status: 503 },
    );
  }
  try {
    const profile = await requireHubSessionProfile(request, database);
    const secret = readCookie(request.headers.get("cookie"), HUB_SESSION_COOKIE);
    const activeSession = secret && secret.length >= 32 && secret.length <= 512
      ? await database.prepare(
        "SELECT 1 AS active FROM sessions WHERE secret_hash=? AND revoked_at IS NULL AND expires_at>? LIMIT 1"
      ).bind(await hashHubSessionSecret(secret), new Date().toISOString()).first<{ active: number }>()
      : null;
    const accountLink = await database.prepare(
      "SELECT 1 AS linked FROM account_profile_links WHERE profile_id=? LIMIT 1"
    ).bind(profile.id).first<{ linked: number }>();
    return NextResponse.json({
      profile,
      accountLinked: Boolean(accountLink),
      authenticated: Boolean(activeSession)
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ profile: null, accountLinked: false, authenticated: false });
    }
    return NextResponse.json(
      { error: "セッションを確認できません。しばらくしてから再度お試しください。" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const handle = localDevelopmentAutoLoginHandle(request, process.env);
  if (!handle) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "cross_origin_request" }, { status: 403 });
  }
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "service_unavailable" }, { status: 503 });

  const profile = await database.prepare(`SELECT p.id,p.handle,p.display_name
      FROM profiles p
      WHERE p.handle=? COLLATE NOCASE
        AND EXISTS (
          SELECT 1 FROM account_profile_links l WHERE l.profile_id=p.id
        )
      LIMIT 1`)
    .bind(handle)
    .first<{ id: string; handle: string; display_name: string }>();
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const secret = localSessionSecret();
  const createdAt = new Date();
  const createdAtIso = createdAt.toISOString();
  const expiresAt = new Date(createdAt.getTime() + LOCAL_SESSION_LIFETIME_MS).toISOString();
  await database.batch([
    database.prepare("DELETE FROM sessions WHERE profile_id=? AND (revoked_at IS NOT NULL OR expires_at<=?)")
      .bind(profile.id, createdAtIso),
    database.prepare(`INSERT INTO sessions (
      id,profile_id,secret_hash,created_at,last_seen_at,expires_at,revoked_at
    ) VALUES (?,?,?,?,?,?,NULL)`)
      .bind(
        crypto.randomUUID(),
        profile.id,
        await hashHubSessionSecret(secret),
        createdAtIso,
        createdAtIso,
        expiresAt,
      ),
  ]);

  const response = NextResponse.json({
    authenticated: true,
    localDevelopment: true,
    profile: { handle: profile.handle, displayName: profile.display_name },
  });
  response.headers.set("cache-control", "no-store");
  setHubSessionCookie(response, request, secret, expiresAt);
  return response;
}
