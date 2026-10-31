import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { getHubVideoQuota, issueHubVideoUpload, listOwnHubVideos, type HubVideoUploadInput } from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { NO_STORE, nativeVideoErrorResponse, rejectNativeVideoRequest } from "@/lib/server/hub-videos-route";

export const dynamic = "force-dynamic";

/**
 * Start a video upload: { title, description?, visibility?, source: "desktop"|"web", sizeBytes,
 * durationSeconds, kind?, license?, ageRestricted?, commentsEnabled? }. Hub checks the plan's
 * 30-day minute caps, reserves storage and signs an upload ticket; the browser then uploads
 * directly to the Video Worker. Hub never receives the video.
 */
export async function POST(request: Request) {
  const rejected = rejectNativeVideoRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== "object") {
      return NextResponse.json({ error: "リクエストが正しくありません。", code: "invalid_input" }, { status: 400, headers: NO_STORE });
    }
    const upload = await issueHubVideoUpload(database, hubVideoDepsFromEnv(), profile.id, input as HubVideoUploadInput);
    return NextResponse.json({ upload }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}

/** The signed-in author's own videos and what is left of the plan's 30-day minutes (null when it cannot be read). */
export async function GET(request: Request) {
  const rejected = rejectNativeVideoRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const deps = hubVideoDepsFromEnv();
    const [videos, quota] = await Promise.all([listOwnHubVideos(database, profile.id), getHubVideoQuota(database, deps, profile.id)]);
    return NextResponse.json({ videos, quota }, { headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}
