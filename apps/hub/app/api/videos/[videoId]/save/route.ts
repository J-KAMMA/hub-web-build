import { NextResponse } from "next/server";

import { saveD1ExternalVideo, unsaveD1ExternalVideo } from "@/lib/server/d1-video-library";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

async function mutate(request: Request, params: Promise<{ videoId: string }>, saved: boolean) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { videoId } = await params;
    if (saved && !(await saveD1ExternalVideo(database, viewer.id, videoId))) {
      return NextResponse.json({ error: "動画が見つかりません。" }, { status: 404 });
    }
    if (!saved) await unsaveD1ExternalVideo(database, viewer.id, videoId);
    return NextResponse.json({ saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: "保存状態を更新できませんでした。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  return mutate(request, params, true);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  return mutate(request, params, false);
}
