import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";

export async function GET(request: Request) {
  const database = getHubD1();
  try {
    const profile = await requireHubSessionProfile(request, database);
    const rows = await database.prepare(`SELECT id, body, audience, scheduled_at AS scheduledAt, status, created_at AS createdAt
      FROM social_scheduled_posts WHERE author_profile_id = ? ORDER BY scheduled_at DESC LIMIT 100`)
      .bind(profile.id).all();
    return NextResponse.json({ posts: rows.results });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  const database = getHubD1();
  try {
    const profile = await requireHubSessionProfile(request, database);
    const input = await request.json().catch(() => null) as { id?: string; body?: string; audience?: string; scheduledAt?: string } | null;
    const body = input?.body?.trim() ?? "";
    const scheduledAt = new Date(input?.scheduledAt ?? "");
    if (!input?.id || !body || body.length > HUB_SOCIAL_POST_MAX_CHARACTERS || !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 60_000) {
      return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    }
    const result = await database.prepare(`UPDATE social_scheduled_posts SET body = ?, audience = ?, scheduled_at = ?
      WHERE id = ? AND author_profile_id = ? AND status = 'scheduled'`)
      .bind(body, input.audience === "followers" ? "followers" : "public", scheduledAt.toISOString(), input.id, profile.id).run();
    if (!result.meta.changes) return NextResponse.json({ error: "schedule_not_editable" }, { status: 404 });
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  const database = getHubD1();
  try {
    const profile = await requireHubSessionProfile(request, database);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
    const result = await database.prepare(`UPDATE social_scheduled_posts SET status = 'cancelled'
      WHERE id = ? AND author_profile_id = ? AND status IN ('scheduled','failed')`).bind(id, profile.id).run();
    if (!result.meta.changes) return NextResponse.json({ error: "schedule_not_editable" }, { status: 404 });
    return NextResponse.json({ cancelled: true });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    throw error;
  }
}
