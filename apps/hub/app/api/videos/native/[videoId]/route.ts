import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { deleteHubVideo, getOwnHubVideo, updateHubVideo } from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { NO_STORE, nativeVideoErrorResponse, rejectNativeVideoRequest } from "@/lib/server/hub-videos-route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ videoId: string }> };

/**
 * The owner's status read. Hub asks the Video Worker for the asset's state with a status ticket,
 * finishes the storage steps (commit, adopt, release) and returns Hub's own view.
 */
export async function GET(request: Request, { params }: Context) {
  const rejected = rejectNativeVideoRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    const { videoId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json({ video: await getOwnHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId) }, { headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}

/** Edit title, description, visibility, age restriction, comments. */
export async function PATCH(request: Request, { params }: Context) {
  const rejected = rejectNativeVideoRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { videoId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const video = await updateHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId, input);
    return NextResponse.json({ video }, { headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}

/** Delete: Hub stops serving it at once, then the Video Worker removes the bytes and Hub releases the storage. */
export async function DELETE(request: Request, { params }: Context) {
  const rejected = rejectNativeVideoRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { videoId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json(await deleteHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId), { headers: NO_STORE });
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}
