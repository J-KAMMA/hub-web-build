import "server-only";

import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalDesktopHubProfile, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import {
  deleteHubVideo,
  getHubVideoQuota,
  getOwnHubVideo,
  issueHubVideoPlayTicket,
  issueHubVideoPreviewTicket,
  issueHubVideoUpload,
  listOwnHubVideos,
  publishHubVideo,
  unpublishOwnHubVideo,
  updateHubVideo,
  type HubVideoUploadInput,
} from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { NO_STORE, nativeVideoErrorResponse, rejectNativeVideoRequest } from "@/lib/server/hub-videos-route";

/**
 * Desktop (bearer assertion) mirrors of /api/videos/native/**. Authentication is the only difference
 * from the web routes: every authorization, visibility, gate, age and review check lives in the shared
 * hub-videos functions called here. Bearer requests carry no cookie, so no Origin check applies.
 */
export type VideoIdContext = { params: Promise<{ videoId: string }> };

async function guarded(request: Request, run: (database: ReturnType<typeof getHubD1>) => Promise<NextResponse>) {
  const rejected = rejectNativeVideoRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    return await run(getHubD1());
  } catch (error) {
    return nativeVideoErrorResponse(error);
  }
}

export const desktopVideoCreate = (request: Request) => guarded(request, async (database) => {
  const profile = await requireDesktopHubProfile(request, database);
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "リクエストが正しくありません。", code: "invalid_input" }, { status: 400, headers: NO_STORE });
  }
  const upload = await issueHubVideoUpload(database, hubVideoDepsFromEnv(), profile.id, input as HubVideoUploadInput);
  return NextResponse.json({ upload }, { status: 201, headers: NO_STORE });
});

export const desktopVideoList = (request: Request) => guarded(request, async (database) => {
  const profile = await requireDesktopHubProfile(request, database);
  const deps = hubVideoDepsFromEnv();
  const [videos, quota] = await Promise.all([listOwnHubVideos(database, profile.id), getHubVideoQuota(database, deps, profile.id)]);
  return NextResponse.json({ videos, quota }, { headers: NO_STORE });
});

export const desktopVideoGet = (request: Request, { params }: VideoIdContext) => guarded(request, async (database) => {
  const { videoId } = await params;
  const profile = await requireDesktopHubProfile(request, database);
  return NextResponse.json({ video: await getOwnHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId) }, { headers: NO_STORE });
});

export const desktopVideoUpdate = (request: Request, { params }: VideoIdContext) => guarded(request, async (database) => {
  const { videoId } = await params;
  const profile = await requireDesktopHubProfile(request, database);
  const input = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return NextResponse.json({ video: await updateHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId, input) }, { headers: NO_STORE });
});

export const desktopVideoDelete = (request: Request, { params }: VideoIdContext) => guarded(request, async (database) => {
  const { videoId } = await params;
  const profile = await requireDesktopHubProfile(request, database);
  return NextResponse.json(await deleteHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId), { headers: NO_STORE });
});

export const desktopVideoPublish = (request: Request, { params }: VideoIdContext) => guarded(request, async (database) => {
  const { videoId } = await params;
  const profile = await requireDesktopHubProfile(request, database);
  return NextResponse.json({ video: await publishHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId) }, { headers: NO_STORE });
});

export const desktopVideoUnpublish = (request: Request, { params }: VideoIdContext) => guarded(request, async (database) => {
  const { videoId } = await params;
  const profile = await requireDesktopHubProfile(request, database);
  return NextResponse.json({ video: await unpublishOwnHubVideo(database, hubVideoDepsFromEnv(), profile.id, videoId) }, { headers: NO_STORE });
});

/** Play and preview resolve the viewer from the bearer when present (a bad bearer is a 401, not an anonymous play). */
export const desktopVideoPlay = (request: Request, { params }: VideoIdContext) => guarded(request, async (database) => {
  const { videoId } = await params;
  const viewer = await getOptionalDesktopHubProfile(request, database);
  return NextResponse.json({ play: await issueHubVideoPlayTicket(database, hubVideoDepsFromEnv(), viewer?.id ?? null, videoId) }, { headers: NO_STORE });
});

export const desktopVideoPreview = (request: Request, { params }: VideoIdContext) => guarded(request, async (database) => {
  const { videoId } = await params;
  const viewer = await getOptionalDesktopHubProfile(request, database);
  return NextResponse.json({ play: await issueHubVideoPreviewTicket(database, hubVideoDepsFromEnv(), viewer?.id ?? null, videoId) }, { headers: NO_STORE });
});
