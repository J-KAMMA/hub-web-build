import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const jobId = new URL(request.url).searchParams.get("jobId") ?? "";
    if (!jobId) {
      const [jobs, quota] = await Promise.all([
        database.prepare(
          `SELECT id, status, control_state controlState, total_count totalCount,
                  succeeded_count succeededCount, failed_count failedCount,
                  attempt_count attemptCount, error_message errorMessage, created_at createdAt
           FROM video_import_jobs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 50`,
        ).bind(viewer.id).all(),
        database.prepare(
          `SELECT used_units usedUnits FROM youtube_api_quota_usage ORDER BY quota_date DESC LIMIT 1`,
        ).first<{ usedUnits: number }>(),
      ]);
      return NextResponse.json({ jobs: jobs.results ?? [], quota: { usedUnits: quota?.usedUnits ?? 0, limit: 10000 } });
    }
    const job = await database.prepare(
      `SELECT id, status, total_count totalCount, succeeded_count succeededCount,
              failed_count failedCount, error_message errorMessage
       FROM video_import_jobs WHERE id = ? AND profile_id = ? LIMIT 1`,
    ).bind(jobId, viewer.id).first();
    return job
      ? NextResponse.json({ job })
      : NextResponse.json({ error: "インポートジョブが見つかりません。" }, { status: 404 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: "ジョブ状態を取得できませんでした。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  return NextResponse.json({
    error: "YouTube動画のインポートジョブは終了しました。",
  }, { status: 410 });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  return NextResponse.json({
    error: "YouTube動画の一括インポートは終了しました。",
  }, { status: 410 });
}
