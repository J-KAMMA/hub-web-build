import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const { threadId } = await params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const thread = await database.prepare("SELECT id FROM threads WHERE id = ?").bind(threadId).first();
    if (!thread) return NextResponse.json({ error: "スレッドが見つかりません。" }, { status: 404 });

    const body = await request.json().catch(() => ({})) as { details?: string };
    const details = String(body.details ?? "").trim().slice(0, 500);
    await database.prepare(`INSERT INTO thread_summary_reports
      (id, thread_id, reporter_profile_id, details, status, created_at)
      VALUES (?, ?, ?, ?, 'open', ?)
      ON CONFLICT(thread_id, reporter_profile_id, status)
      DO UPDATE SET details = excluded.details, created_at = excluded.created_at`)
      .bind(crypto.randomUUID(), threadId, viewer.id, details, new Date().toISOString()).run();
    return NextResponse.json({ reported: true });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "報告するにはログインしてください。" }, { status: 401 });
    }
    throw error;
  }
}
