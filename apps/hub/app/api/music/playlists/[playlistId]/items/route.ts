import { NextResponse } from "next/server";

import { InvalidMusicPlaylistError, parseMusicPlaylistItems, replaceD1MusicPlaylistItems } from "@/lib/server/d1-music-playlists";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function PUT(request: Request, { params }: { params: Promise<{ playlistId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { playlistId } = await params;
    const workIds = parseMusicPlaylistItems(await request.json().catch(() => null));
    if (!(await replaceD1MusicPlaylistItems(database, viewer.id, playlistId, workIds))) return NextResponse.json({ error: "プレイリストが見つかりません。" }, { status: 404 });
    return NextResponse.json({ updated: true, workIds });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof InvalidMusicPlaylistError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
