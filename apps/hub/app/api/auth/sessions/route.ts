import { NextResponse } from "next/server";

import { clearHubSessionCookie, hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ activeCount: 0 });

  try {
    const profile = await requireHubSessionProfile(request, database);
    const now = new Date().toISOString();
    const row = await database.prepare(`SELECT count(*) AS total
      FROM sessions
      WHERE profile_id = ? AND revoked_at IS NULL AND expires_at > ?`)
      .bind(profile.id, now)
      .first<{ total: number }>();
    return NextResponse.json({ activeCount: Number(row?.total ?? 0) });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ revokedCount: 0 });

  try {
    const profile = await requireHubSessionProfile(request, database);
    const now = new Date().toISOString();
    const result = await database.prepare(`UPDATE sessions
      SET revoked_at = ?
      WHERE profile_id = ? AND revoked_at IS NULL AND expires_at > ?`)
      .bind(now, profile.id, now)
      .run();
    const response = NextResponse.json({ revokedCount: Number(result.meta.changes ?? 0) });
    clearHubSessionCookie(response, request);
    return response;
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    throw error;
  }
}
