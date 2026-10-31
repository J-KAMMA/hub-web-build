import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { issueHubVideoPlayTicket } from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { NO_STORE, nativeVideoErrorResponse, rejectNativeVideoRequest } from "@/lib/server/hub-videos-route";

export const dynamic = "force-dynamic";

/**
 * A single-use play ticket (5 minutes at most), issued only after Hub's own visibility, follow,
 * token-gate and age checks for this viewer. The browser presents it to `play.path` on the Video
 * Worker; Hub never streams video or sees a playback token.
 */
export async function POST(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const rejected = rejectNativeVideoRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { videoId } = await params;
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
    const play = await issueHubVideoPlayTicket(database, hubVideoDepsFromEnv(), viewer?.id ?? null, videoId);
    return NextResponse.json({ play }, { headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}
