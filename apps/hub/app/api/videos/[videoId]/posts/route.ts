import { NextResponse } from "next/server";

import { resolveHubFeatureFlag } from "@/lib/platform/feature-flags";
import { RepostCooldownError } from "@/lib/repost-cooldown";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import { createD1SocialPost, SocialPostLinkConflictError, SocialPostVideoNotFoundError } from "@/lib/server/d1-social-posts";
import { HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { InvalidVideoPostCursorError, listD1VideoPosts } from "@/lib/server/d1-video-posts";
import { federateNewPost } from "@/lib/server/video-comment-federation";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";
import { hubVideoCommentOwner, mayViewVideoComments, VideoCommentRefusedError } from "@/lib/server/video-comment-access";

type Context = { params: Promise<{ videoId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const fail = (error: string, status: number, extra: HeadersInit = {}) =>
  NextResponse.json({ error }, { status, headers: { ...headers, ...extra } });
const flags = {
  getBoolean(key: string) {
    if (key !== "social.posting") return undefined;
    const value = process.env.HUB_FEATURE_SOCIAL_POSTING?.trim().toLowerCase();
    return value === "true" ? true : value === "false" ? false : undefined;
  },
};
const validId = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** この動画に紐づくポストの続き。 */
export async function GET(request: Request, { params }: Context) {
  const { videoId } = await params;
  if (!validId(videoId)) return fail("invalid_request", 400);
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    // Nothing about a gated video's comments loads for a viewer who cannot open the video.
    if (!(await mayViewVideoComments(database, viewer?.id ?? null, videoId))) return fail("video_locked", 403);
    const params = new URL(request.url).searchParams;
    const hiddenOnly = params.get("hidden") === "1";
    // The hidden list belongs to the owner of a Hub-hosted video; nobody else can read it.
    if (hiddenOnly && (!viewer || (await hubVideoCommentOwner(database, videoId)) !== viewer.id)) return fail("forbidden", 403);
    const page = await listD1VideoPosts(database, videoId, viewer?.id ?? null, params.get("cursor"), { hiddenOnly });
    return NextResponse.json(page, { headers });
  } catch (error) {
    if (error instanceof InvalidVideoPostCursorError) return fail("invalid_request", 400);
    return fail("video_posts_unavailable", 503);
  }
}

/** 動画へのコメント（動画に返信するポスト）。フィードに出すのは inFeed=true のときだけ。 */
export async function POST(request: Request, { params }: Context) {
  const { videoId } = await params;
  if (!validId(videoId)) return fail("invalid_request", 400);
  if (!hasSameOrigin(request)) return fail("invalid_origin", 403);
  if (!(await resolveHubFeatureFlag("social.posting", flags))) return fail("social_posting_disabled", 503);
  const input = (await request.json().catch(() => null)) as {
    body?: unknown; audience?: unknown; inFeed?: unknown; parentPostId?: unknown; playbackSeconds?: unknown;
  } | null;
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.body !== "string") return fail("invalid_request", 400);
  if ((input.inFeed !== undefined && typeof input.inFeed !== "boolean")
    || (input.parentPostId !== undefined && input.parentPostId !== null && (typeof input.parentPostId !== "string" || !validId(input.parentPostId)))
    || (input.playbackSeconds !== undefined && input.playbackSeconds !== null && (typeof input.playbackSeconds !== "number" || !Number.isFinite(input.playbackSeconds)))) {
    return fail("invalid_request", 400);
  }
  const body = input.body.trim();
  if (!body) return fail("invalid_request", 400);
  if (body.length > HUB_SOCIAL_POST_MAX_CHARACTERS) return fail("post_too_long", 400);
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const audience = input.audience === "followers" ? "followers" : "public";
    const post = await createD1SocialPost(database, viewer, {
      body, identityMode: "account", audience, videoId,
      replyToPostId: typeof input.parentPostId === "string" ? input.parentPostId : null,
      replyToVideoSeconds: typeof input.playbackSeconds === "number" ? input.playbackSeconds : null,
      inFeed: input.inFeed === true,
    });
    if (audience === "public") await federateNewPost(database, post);
    return NextResponse.json({ post }, { status: 201, headers });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return fail("authentication_required", 401);
    if (error instanceof VideoCommentRefusedError) return fail(error.reason, 403);
    if (error instanceof HubProfileBlockedError) return fail("forbidden", 403);
    if (error instanceof SocialPostVideoNotFoundError) return fail("not_found", 404);
    if (error instanceof SocialPostLinkConflictError) return fail("invalid_request", 400);
    if (error instanceof RepostCooldownError) return fail("cooldown", 429);
    if (error instanceof HubPostRateLimitError) {
      return fail("rate_limited", 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    if (error instanceof Error && error.message.startsWith("content_share_")) return fail("post_too_long", 400);
    return fail("video_posts_unavailable", 503);
  }
}
