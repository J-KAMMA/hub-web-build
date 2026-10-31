import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";
import { listUnifiedReports, type UnifiedReport } from "@/lib/server/unified-moderation";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
      denied.headers.set(name, value);
    }
    return denied;
  }
  const db = getHubD1();
  const status = new URL(request.url).searchParams.get("status") || "open";
  const [reports, videos, music] = await Promise.all([
    listUnifiedReports(db, status),
    db.prepare(`SELECT r.id, r.reason, r.status, r.created_at, r.video_id target_id, v.title preview
      FROM video_reports r JOIN external_videos v ON v.id=r.video_id
      WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC LIMIT 100`).bind(status, status).all<any>(),
    db.prepare(`SELECT id, reason, details, status, created_at, music_work_id target_id, music_work_id preview
      FROM music_reports WHERE (?='all' OR status=?) ORDER BY created_at DESC LIMIT 100`).bind(status, status).all<any>(),
  ]);
  const videoReports = videos.results.map((row): UnifiedReport => ({ id: row.id, kind: "video", reason: row.reason, details: row.reason, status: row.status, createdAt: row.created_at, targetId: row.target_id, preview: row.preview }));
  const musicReports = music.results.map((row): UnifiedReport => ({ id: row.id, kind: "music", reason: row.reason, details: row.details,
    status: row.status, createdAt: row.created_at, targetId: row.target_id, preview: row.preview }));
  return NextResponse.json(
    { reports: [...reports, ...videoReports, ...musicReports].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },
    { headers: PRIVATE_HEADERS },
  );
}
