import "server-only";
import { resolveHubFeatureFlag } from "@/lib/platform/feature-flags";
import { toClientPost } from "@/lib/client-feed-shape";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import { RepostCooldownError } from "@/lib/repost-cooldown";
import { DesktopHubAuthenticationError, getOptionalDesktopHubProfile, requireDesktopHubProfile } from "./desktop-hub-auth";
import { getHubD1 } from "./hub-d1";
import { hasSameOrigin } from "./hub-auth-route";
import { HubSuspendedError } from "./hub-session";
import { HubProfileBlockedError } from "./profile-blocks";
import { HubPostRateLimitError } from "./d1-rate-limit";
import { createD1SocialPost, SocialPostLinkConflictError, SocialPostVideoNotFoundError } from "./d1-social-posts";
import { InvalidVideoPostCursorError, listD1VideoPosts } from "./d1-video-posts";
import { federateNewPost } from "./video-comment-federation";
import { hubVideoCommentOwner, mayViewVideoComments, VideoCommentRefusedError } from "./video-comment-access";

type Params = { videoId: string };
const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", ...extra } });
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/u.test(value);
const postingFlags = {
  getBoolean(key: string) {
    if (key !== "social.posting") return undefined;
    const value = process.env.HUB_FEATURE_SOCIAL_POSTING?.trim().toLowerCase();
    return value === "true" ? true : value === "false" ? false : undefined;
  },
};

/** GET /api/client/videos/{videoId}/posts?cursor= and POST (同じ経路で作る). */
export async function clientVideoPosts(request: Request, params: Promise<Params>, operation: "list" | "create") {
  try {
    const { videoId } = await params;
    if (!identifier(videoId)) return json({ error: "invalid_request" }, 400);
    const url = new URL(request.url);
    if (operation === "create" && url.search) return json({ error: "invalid_request" }, 400);
    if (operation === "list" && [...url.searchParams.keys()].some((key) => key !== "cursor" && key !== "hidden")) return json({ error: "invalid_request" }, 400);
    if (operation === "create" && request.headers.has("origin") && !hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1();
    if (operation === "list") {
      const viewer = await getOptionalDesktopHubProfile(request, database);
      const exists = await database.prepare("SELECT id FROM external_videos WHERE id = ? AND status = 'active' LIMIT 1").bind(videoId).first();
      if (!exists) return json({ error: "not_found" }, 404);
      if (!(await mayViewVideoComments(database, viewer?.id ?? null, videoId))) return json({ error: "video_locked" }, 403);
      const hiddenOnly = url.searchParams.get("hidden") === "1";
      if (hiddenOnly && (!viewer || (await hubVideoCommentOwner(database, videoId)) !== viewer.id)) return json({ error: "forbidden" }, 403);
      const page = await listD1VideoPosts(database, videoId, viewer?.id ?? null, url.searchParams.get("cursor"), { hiddenOnly });
      return json({ posts: page.posts.map((post) => toClientPost(post)), nextCursor: page.nextCursor });
    }
    const viewer = await requireDesktopHubProfile(request, database);
    if (!(await resolveHubFeatureFlag("social.posting", postingFlags))) return json({ error: "social_posting_disabled" }, 503);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "invalid_request" }, 400);
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["body", "audience", "inFeed", "parentPostId", "playbackSeconds"].includes(key))
      || typeof input.body !== "string"
      || (input.audience !== undefined && !["public", "followers"].includes(String(input.audience)))
      || (input.inFeed !== undefined && typeof input.inFeed !== "boolean")
      || (input.parentPostId !== undefined && input.parentPostId !== null && (typeof input.parentPostId !== "string" || !identifier(input.parentPostId)))
      || (input.playbackSeconds !== undefined && input.playbackSeconds !== null && (typeof input.playbackSeconds !== "number" || !Number.isFinite(input.playbackSeconds)))) {
      return json({ error: "invalid_request" }, 400);
    }
    const body = input.body.normalize("NFKC").replace(/\r\n/g, "\n").trim();
    if (!body || body.length > HUB_SOCIAL_POST_MAX_CHARACTERS) return json({ error: "invalid_request" }, 400);
    const audience = input.audience === "followers" ? "followers" : "public";
    const post = await createD1SocialPost(database, viewer, {
      body, identityMode: "account", audience, videoId,
      replyToPostId: typeof input.parentPostId === "string" ? input.parentPostId : null,
      replyToVideoSeconds: typeof input.playbackSeconds === "number" ? input.playbackSeconds : null,
      inFeed: input.inFeed === true,
    });
    if (audience === "public") await federateNewPost(database, post);
    return json({ post: toClientPost(post) }, 201);
  } catch (error) {
    if (error instanceof InvalidVideoPostCursorError) return json({ error: "invalid_request" }, 400);
    if (error instanceof SocialPostVideoNotFoundError) return json({ error: "not_found" }, 404);
    if (error instanceof SocialPostLinkConflictError) return json({ error: "invalid_request" }, 400);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof VideoCommentRefusedError) return json({ error: error.reason }, 403);
    if (error instanceof HubProfileBlockedError) return json({ error: "blocked" }, 403);
    if (error instanceof RepostCooldownError) return json({ error: "cooldown", retryAt: error.retryAt }, 429);
    if (error instanceof HubPostRateLimitError) {
      return json({ error: "rate_limited", retryAfterSeconds: error.retryAfterSeconds }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    if (error instanceof Error && error.message.startsWith("content_share_")) return json({ error: "invalid_request" }, 400);
    return json({ error: "video_posts_unavailable" }, 503);
  }
}
