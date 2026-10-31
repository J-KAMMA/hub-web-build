import { NextResponse } from "next/server";

import { listD1SavedVideos, listD1VideoPlaylists } from "@/lib/server/d1-video-library";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const [savedVideos, playlists] = await Promise.all([
      listD1SavedVideos(database, viewer.id),
      listD1VideoPlaylists(database, viewer.id)
    ]);
    return NextResponse.json({ savedVideoIds: savedVideos.map((video) => video.id), savedVideos, playlists }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: "動画ライブラリを読み込めませんでした。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
