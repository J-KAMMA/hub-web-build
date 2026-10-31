import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import {
  validateYouTubeMusicVideo,
  YouTubeMusicRejectedError,
} from "@/lib/server/youtube-music-validation";

type SourceRow = { id: string; provider: string; source_url: string };

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request); if (denied) return denied;
  const db = getOptionalHubD1(); if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const result = await db.prepare(`SELECT availability_status status, COUNT(*) total FROM music_service_links GROUP BY availability_status`).all<{ status: string; total: number }>();
  return NextResponse.json({ counts: Object.fromEntries(result.results.map((row) => [row.status, Number(row.total)])) });
}

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) || requireSameOrigin(request); if (denied) return denied;
  const db = getOptionalHubD1(); if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const rows = await db.prepare(`SELECT id, provider, source_url FROM music_service_links
    ORDER BY COALESCE(availability_checked_at, '') ASC LIMIT 20`).all<SourceRow>();
  let available = 0, unavailable = 0, deferred = 0;
  for (const row of rows.results) {
    if (row.provider !== "youtube") { deferred += 1; continue; }
    try {
      let status = "available";
      try {
        await validateYouTubeMusicVideo(row.source_url);
      } catch (error) {
        if (error instanceof YouTubeMusicRejectedError) status = "unavailable";
        else throw error;
      }
      if (status === "available") available += 1; else if (status === "unavailable") unavailable += 1; else deferred += 1;
      await db.prepare("UPDATE music_service_links SET availability_status=?, availability_checked_at=? WHERE id=?")
        .bind(status, new Date().toISOString(), row.id).run();
    } catch { deferred += 1; }
  }
  return NextResponse.json({ checked: rows.results.length, available, unavailable, deferred });
}
