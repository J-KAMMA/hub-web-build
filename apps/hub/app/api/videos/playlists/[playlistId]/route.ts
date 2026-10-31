import { NextResponse } from "next/server";

import { deleteD1VideoPlaylist, InvalidVideoPlaylistError, parseVideoPlaylistUpdate, updateD1VideoPlaylist } from "@/lib/server/d1-video-library";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

async function viewer(request: Request) {
  const database = getHubD1();
  return { database, profile: await requireHubSessionProfile(request, database) };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ playlistId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { database, profile } = await viewer(request);
    const { playlistId } = await params;
    const input = parseVideoPlaylistUpdate(await request.json().catch(() => null));
    if (!(await updateD1VideoPlaylist(database, profile.id, playlistId, input))) {
      return NextResponse.json({ error: "プレイリストが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof InvalidVideoPlaylistError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ playlistId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { database, profile } = await viewer(request);
    const { playlistId } = await params;
    if (!(await deleteD1VideoPlaylist(database, profile.id, playlistId))) {
      return NextResponse.json({ error: "プレイリストが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
}
