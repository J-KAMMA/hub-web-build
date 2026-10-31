import { NextResponse } from "next/server";

import { DesktopHubAuthenticationError, getOptionalHubViewerProfile, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { getD1VideoEngagement, setD1VideoLike } from "@/lib/server/d1-video-engagement";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubSuspendedError } from "@/lib/server/hub-session";

const HEADERS = { "cache-control": "no-store" };
const VIDEO_ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

type Context = { params: Promise<{ videoId: string }> };

function failure(error: unknown) {
  if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers: HEADERS });
  if (error instanceof DesktopHubAuthenticationError) return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401, headers: HEADERS });
  // d1-video-engagement throws a plain Error when the video is not an active catalog row.
  if (error instanceof Error && error.message === "動画が見つかりません。") return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  return NextResponse.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
}

async function readVideoId(context: Context) {
  const { videoId } = await context.params;
  return VIDEO_ID.test(videoId) ? videoId : null;
}

export async function GET(request: Request, context: Context) {
  const videoId = await readVideoId(context);
  if (!videoId) return NextResponse.json({ error: "invalid_video_id" }, { status: 400, headers: HEADERS });
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubViewerProfile(request, database).catch(() => null);
    return NextResponse.json(await getD1VideoEngagement(database, videoId, viewer?.id), { headers: HEADERS });
  } catch (error) {
    return failure(error);
  }
}

async function setLike(request: Request, context: Context, liked: boolean) {
  const videoId = await readVideoId(context);
  if (!videoId) return NextResponse.json({ error: "invalid_video_id" }, { status: 400, headers: HEADERS });
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json(await setD1VideoLike(database, videoId, viewer.id, liked), { headers: HEADERS });
  } catch (error) {
    return failure(error);
  }
}

export const POST = (request: Request, context: Context) => setLike(request, context, true);
export const DELETE = (request: Request, context: Context) => setLike(request, context, false);
