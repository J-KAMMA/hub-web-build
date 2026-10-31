import { NextResponse } from "next/server";

import { addD1VideoPlaylistItem, removeD1VideoPlaylistItem, VideoPlaylistNotFoundError } from "@/lib/server/d1-video-library";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

async function mutate(request: Request, params: Promise<{ playlistId: string; videoId: string }>, add: boolean) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const { playlistId, videoId } = await params;
    const success = add
      ? await addD1VideoPlaylistItem(database, viewer.id, playlistId, videoId)
      : await removeD1VideoPlaylistItem(database, viewer.id, playlistId, videoId);
    if (add && !success) return NextResponse.json({ error: "動画が見つかりません。" }, { status: 404 });
    return NextResponse.json(add ? { added: true } : { removed: success });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof VideoPlaylistNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ playlistId: string; videoId: string }> }) {
  return mutate(request, params, true);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ playlistId: string; videoId: string }> }) {
  return mutate(request, params, false);
}
