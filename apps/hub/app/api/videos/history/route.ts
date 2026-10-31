import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { listD1VideoProfileActivity, parseVideoProfileActivity, upsertD1VideoProfileActivity } from "@/lib/server/d1-video-profile-activity";

export async function GET(request: Request) {
  const database = getHubD1();
  const profile = await requireHubSessionProfile(request, database);
  return NextResponse.json({ activity: await listD1VideoProfileActivity(database, profile.id) });
}

export async function POST(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = parseVideoProfileActivity(await request.json());
    await upsertD1VideoProfileActivity(database, profile.id, input);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "視聴状態を保存できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const database = getHubD1();
  const profile = await requireHubSessionProfile(request, database);
  const videoId = new URL(request.url).searchParams.get("videoId")?.trim();
  if (videoId) await database.prepare("DELETE FROM video_profile_activity WHERE profile_id = ? AND video_id = ?").bind(profile.id, videoId).run();
  else await database.prepare("DELETE FROM video_profile_activity WHERE profile_id = ?").bind(profile.id).run();
  return NextResponse.json({ deleted: true });
}
