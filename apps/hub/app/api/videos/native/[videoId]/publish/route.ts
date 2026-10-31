import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { publishHubVideo } from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { NO_STORE, nativeVideoErrorResponse, rejectNativeVideoRequest } from "@/lib/server/hub-videos-route";

export const dynamic = "force-dynamic";

/** Publish a processed video. Hub signs a publish ticket and sends the state change to the Video Worker itself. */
export async function POST(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const rejected = rejectNativeVideoRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { videoId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json({ video: await publishHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId) }, { headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}
