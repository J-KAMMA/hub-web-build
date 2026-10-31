import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { ExternalMusicWorkNotFoundError, reportD1ExternalMusicWork } from "@/lib/server/d1-external-music-reports";

const REASONS = new Set(["not_music", "duplicate", "wrong_metadata", "unavailable", "rights", "other"]);

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => null) as { workId?: unknown; reason?: unknown; details?: unknown } | null;
  const workId = typeof body?.workId === "string" ? body.workId.trim().slice(0, 160) : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const details = typeof body?.details === "string" ? body.details.trim().slice(0, 1000) : "";
  if (!workId || !REASONS.has(reason)) return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    await reportD1ExternalMusicWork(database, viewer.id, workId, reason, details);
    return NextResponse.json({ reported: true });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof ExternalMusicWorkNotFoundError) return NextResponse.json({ error: "作品が見つかりません。" }, { status: 404 });
    return NextResponse.json({ error: "通報を送信できませんでした。" }, { status: 500 });
  }
}
