import { NextResponse } from "next/server";

import { removeD1ExternalVideo } from "@/lib/server/d1-videos";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function DELETE(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  try {
    const { videoId } = await params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const removed = await removeD1ExternalVideo(database, videoId, viewer.id);
    if (!removed) return NextResponse.json({ error: "動画が見つからないか、削除する権限がありません。" }, { status: 404 });
    return NextResponse.json({ message: "動画をカタログから削除しました。" });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
}
