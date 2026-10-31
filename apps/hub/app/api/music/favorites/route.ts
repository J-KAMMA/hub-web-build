import { NextResponse } from "next/server";

import { listD1MusicFavoriteIds, replaceD1MusicFavorites } from "@/lib/server/d1-music-favorites";
import { InvalidMusicPlaylistError, parseMusicPlaylistItems } from "@/lib/server/d1-music-playlists";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({ favoriteIds: await listD1MusicFavoriteIds(database, viewer.id) });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const favoriteIds = parseMusicPlaylistItems(await request.json().catch(() => null));
    await replaceD1MusicFavorites(database, viewer.id, favoriteIds);
    return NextResponse.json({ updated: true, favoriteIds });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof InvalidMusicPlaylistError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
