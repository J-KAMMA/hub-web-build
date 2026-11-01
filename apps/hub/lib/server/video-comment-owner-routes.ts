import "server-only";
import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, HubSuspendedError } from "@/lib/server/hub-session";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import {
  setCommentHiddenByVideoOwner,
  setVideoCommentPolicy,
  VIDEO_COMMENT_POLICIES,
  VideoCommentOwnerError,
} from "@/lib/server/video-comment-owner";
import type { VideoCommentPolicy } from "@/lib/server/video-comment-access";

/* Shared by the web and Desktop (client) owner routes. A browser session needs a same-origin request; Desktop sends a Bearer token. */
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
const identifier = (value: string) => /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);

function failure(error: unknown) {
  if (error instanceof HubAuthenticationError) return json({ error: "authentication_required" }, 401);
  if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
  if (error instanceof VideoCommentOwnerError) return json({ error: error.reason }, error.reason === "forbidden" ? 403 : 404);
  if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
  return json({ error: "unavailable" }, 503);
}

function originRefused(request: Request): boolean {
  return !request.headers.has("authorization") ? !hasSameOrigin(request) : request.headers.has("origin") && !hasSameOrigin(request);
}

/** PUT /api/{,client/}videos/{videoId}/comment-policy  { policy: "everyone" | "followers" | "nobody" } */
export async function putCommentPolicy(request: Request, params: Promise<{ videoId: string }>) {
  try {
    const { videoId } = await params;
    if (!identifier(videoId)) return json({ error: "invalid_request" }, 400);
    if (originRefused(request)) return json({ error: "invalid_origin" }, 403);
    const input = (await request.json().catch(() => null)) as { policy?: unknown } | null;
    const policy = input?.policy;
    if (!input || typeof policy !== "string" || !VIDEO_COMMENT_POLICIES.includes(policy as VideoCommentPolicy) || Object.keys(input).length !== 1) {
      return json({ error: "invalid_request" }, 400);
    }
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    await setVideoCommentPolicy(database, viewer.id, videoId, policy as VideoCommentPolicy);
    return json({ policy });
  } catch (error) {
    return failure(error);
  }
}

/** POST hides, DELETE shows again: /api/{,client/}posts/{postId}/hide-on-video */
export async function setHideOnVideo(request: Request, params: Promise<{ postId: string }>, hidden: boolean) {
  try {
    const { postId } = await params;
    if (!identifier(postId)) return json({ error: "invalid_request" }, 400);
    if (originRefused(request)) return json({ error: "invalid_origin" }, 403);
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    await setCommentHiddenByVideoOwner(database, viewer.id, postId, hidden);
    // A hidden comment leaves the federation too. Showing it again does not re-send it.
    if (hidden) {
      const { deleteFederatedPost } = await import("@/lib/server/federation-gateway");
      await deleteFederatedPost(postId).catch(() => undefined);
    }
    return json({ hidden });
  } catch (error) {
    return failure(error);
  }
}
