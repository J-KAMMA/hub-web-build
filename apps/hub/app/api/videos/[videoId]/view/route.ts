import { NextResponse } from "next/server";

import { MOCK_VIDEOS } from "@/lib/mock-video-data";
import { recordD1ExternalVideoView } from "@/lib/server/d1-video-views";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { readCookie } from "@/lib/server/hub-session";

const HUB_VIDEO_VIEWER_COOKIE = "hub.video_viewer";
const VIEWER_TOKEN_PATTERN = /^[0-9a-f-]{36}$/u;

function isSecureRequest(request: Request): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  return forwardedProtocol ? forwardedProtocol === "https" : new URL(request.url).protocol === "https:";
}

async function hashViewerToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const { videoId } = await params;
  const database = getOptionalHubD1();
  if (!database) {
    const mock = MOCK_VIDEOS.find((video) => video.id === videoId);
    if (mock) return NextResponse.json({ recorded: false, viewCount: mock.viewCount });
    return NextResponse.json({ error: "再生数を記録できませんでした。" }, { status: 503 });
  }

  const cookieHeader = request.headers.get("cookie");
  const existingToken = readCookie(cookieHeader, HUB_VIDEO_VIEWER_COOKIE);
  const viewerToken = existingToken && VIEWER_TOKEN_PATTERN.test(existingToken)
    ? existingToken
    : crypto.randomUUID();
  const result = await recordD1ExternalVideoView(database, videoId, await hashViewerToken(viewerToken));
  if (!result.found) {
    return NextResponse.json({ error: "動画が見つかりません。" }, { status: 404 });
  }

  const response = NextResponse.json({ recorded: result.recorded, viewCount: result.viewCount });
  if (viewerToken !== existingToken) {
    response.cookies.set(HUB_VIDEO_VIEWER_COOKIE, viewerToken, {
      httpOnly: true,
      secure: isSecureRequest(request),
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });
  }
  return response;
}
