import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, requireHubSessionProfile } from "@/lib/server/hub-session";
import { getD1VideoEngagement, reportD1Video, setD1VideoLike } from "@/lib/server/d1-video-engagement";
import { isVideoReportReasonCode, videoReportReasonLabel } from "@/lib/video-safety";

export async function GET(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  try {
    const database = getHubD1();
    const profile = await getOptionalHubSessionProfile(request, database);
    return NextResponse.json(await getD1VideoEngagement(database, (await params).videoId, profile?.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "反応を取得できませんでした。" }, { status: 404 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const { videoId } = await params;
    const body = await request.json() as { action?: string; reason?: string; reasonCode?: string };
    if (body.action === "report") {
      const reasonCode = isVideoReportReasonCode(body.reasonCode) ? body.reasonCode : null;
      const detail = (body.reason ?? "").trim();
      const text = reasonCode ? (detail ? `${videoReportReasonLabel(reasonCode)}: ${detail}`.slice(0, 300) : videoReportReasonLabel(reasonCode)) : (detail || "不適切な動画");
      await reportD1Video(database, videoId, profile.id, text, reasonCode);
      if (reasonCode === "child_sexual") {
        // A self-made video stops at once and goes to the front of the operator queue (PLAN 2.3, 5.1).
        const { hubVideoDepsFromEnv } = await import("@/lib/server/hub-videos-env");
        const { applyInstantSafetyHold } = await import("@/lib/server/hub-video-review");
        // Rate-limited per reporter; the answer is the same whether or not the video was held.
        await applyInstantSafetyHold(database, hubVideoDepsFromEnv(), { videoId, reporterProfileId: profile.id });
      }
      const reportCount = Number(await database.prepare("SELECT COUNT(*) AS count FROM video_reports WHERE video_id = ? AND status = 'open'").bind(videoId).first<number>("count") ?? 0);
      if (reportCount >= 5) await database.prepare("UPDATE external_videos SET status = 'removed', updated_at = ? WHERE id = ? AND status = 'active'").bind(new Date().toISOString(), videoId).run();
      return NextResponse.json({ reported: true });
    }
    return NextResponse.json(await setD1VideoLike(database, videoId, profile.id, true));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "操作できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const database = getHubD1();
  const profile = await requireHubSessionProfile(request, database);
  return NextResponse.json(await setD1VideoLike(database, (await params).videoId, profile.id, false));
}
