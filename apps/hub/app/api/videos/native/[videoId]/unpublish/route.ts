import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { unpublishOwnHubVideo } from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { NO_STORE, nativeVideoErrorResponse, rejectNativeVideoRequest } from "@/lib/server/hub-videos-route";

export const dynamic = "force-dynamic";

/** Take a video down. Hub stops issuing play tickets first; the Video Worker is told next and retried if unreachable. */
export async function POST(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const rejected = rejectNativeVideoRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { videoId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json({ video: await unpublishOwnHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId) }, { headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}
