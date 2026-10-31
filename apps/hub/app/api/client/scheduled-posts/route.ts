import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireHubViewerProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError, HubSuspendedError } from "@/lib/server/hub-session";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";

const idPattern = /^[A-Za-z0-9-]{8,80}$/;

function authError(error: unknown) {
  return (
    error instanceof HubAuthenticationError ||
    error instanceof DesktopHubAuthenticationError ||
    error instanceof HubSuspendedError
  );
}

/**
 * クライアント向けの予約投稿管理。ブラウザは /api/social/scheduled が
 * 同一オリジン前提なので別口。一覧・編集・取り消しだけ——
 * 新規作成は POST /api/client/posts の scheduledAt で行う。
 */
export async function GET(request: Request) {
  const database = getHubD1();
  try {
    const viewer = await requireHubViewerProfile(request, database);
    const rows = await database
      .prepare(
        `SELECT id, body, audience, scheduled_at AS scheduledAt, status, created_at AS createdAt
          FROM social_scheduled_posts WHERE author_profile_id = ? ORDER BY scheduled_at DESC LIMIT 100`,
      )
      .bind(viewer.id)
      .all();
    return NextResponse.json(
      { posts: rows.results },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (authError(error)) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const database = getHubD1();
  try {
    const viewer = await requireHubViewerProfile(request, database);
    const input = (await request.json().catch(() => null)) as {
      id?: string;
      body?: string;
      audience?: string;
      scheduledAt?: string;
    } | null;
    const body = input?.body?.trim() ?? "";
    const scheduledAt = new Date(input?.scheduledAt ?? "");
    if (
      !input?.id || !idPattern.test(input.id) ||
      !body || body.length > HUB_SOCIAL_POST_MAX_CHARACTERS ||
      !Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 60_000
    ) {
      return NextResponse.json({ error: "invalid_schedule" }, { status: 400 });
    }
    const result = await database
      .prepare(
        `UPDATE social_scheduled_posts SET body = ?, audience = ?, scheduled_at = ?
          WHERE id = ? AND author_profile_id = ? AND status = 'scheduled'`,
      )
      .bind(
        body,
        input.audience === "followers" ? "followers" : "public",
        scheduledAt.toISOString(),
        input.id,
        viewer.id,
      )
      .run();
    if (!result.meta.changes) {
      return NextResponse.json({ error: "schedule_not_editable" }, { status: 404 });
    }
    return NextResponse.json({ updated: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (authError(error)) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const database = getHubD1();
  try {
    const viewer = await requireHubViewerProfile(request, database);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!idPattern.test(id)) {
      return NextResponse.json({ error: "id_required" }, { status: 400 });
    }
    const result = await database
      .prepare(
        `UPDATE social_scheduled_posts SET status = 'cancelled'
          WHERE id = ? AND author_profile_id = ? AND status IN ('scheduled','failed')`,
      )
      .bind(id, viewer.id)
      .run();
    if (!result.meta.changes) {
      return NextResponse.json({ error: "schedule_not_editable" }, { status: 404 });
    }
    return NextResponse.json({ cancelled: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (authError(error)) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    throw error;
  }
}
