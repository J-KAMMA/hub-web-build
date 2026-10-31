import "server-only";
import { resolveHubFeatureFlag } from "@/lib/platform/feature-flags";
import { toClientPost } from "@/lib/client-feed-shape";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import { RepostCooldownError } from "@/lib/repost-cooldown";
import { DesktopHubAuthenticationError, getOptionalDesktopHubProfile, requireDesktopHubProfile } from "./desktop-hub-auth";
import { getHubD1 } from "./hub-d1";
import { readMusicWorksByIds, validMusicKey } from "./client-music-library";
import { hasSameOrigin } from "./hub-auth-route";
import { HubSuspendedError } from "./hub-session";
import { HubProfileBlockedError } from "./profile-blocks";
import { HubPostRateLimitError } from "./d1-rate-limit";
import { createD1SocialPost, SocialPostLinkConflictError } from "./d1-social-posts";
import { InvalidMusicPostCursorError, listD1MusicPosts } from "./d1-music-posts";
import { publishFederatedPost } from "./federation-gateway";
import { DEFAULT_INSTANCE_ORIGIN } from "@/lib/instance-origin";

type Params = { workId: string };
const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization", ...extra } });
const identifier = (value: unknown): value is string => validMusicKey(value) && !/\p{Cc}/u.test(value);
/** Music側の公開メタデータ（有効なカタログ・公開済みで検査済みの音源）に解決できる作品か。 */
export async function musicWorkExists(database: ReturnType<typeof getHubD1>, workId: string): Promise<boolean> {
  const configured = process.env.HUB_PUBLIC_ORIGIN ?? DEFAULT_INSTANCE_ORIGIN;
  const origin = new URL(configured);
  if (origin.origin !== configured || origin.username || origin.password
    || !(origin.protocol === "https:" || origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) {
    throw new Error("origin");
  }
  const [work] = await readMusicWorksByIds(database, [workId], origin.origin);
  return Boolean(work && work.id === workId);
}
const postingFlags = {
  getBoolean(key: string) {
    if (key !== "social.posting") return undefined;
    const value = process.env.HUB_FEATURE_SOCIAL_POSTING?.trim().toLowerCase();
    return value === "true" ? true : value === "false" ? false : undefined;
  },
};

/** GET /api/client/music/works/{workId}/posts?cursor= and POST (同じ経路で作る). */
export async function clientMusicPosts(request: Request, params: Promise<Params>, operation: "list" | "create") {
  try {
    const { workId } = await params;
    if (!identifier(workId)) return json({ error: "invalid_request" }, 400);
    const url = new URL(request.url);
    if (operation === "create" && url.search) return json({ error: "invalid_request" }, 400);
    if (operation === "list" && [...url.searchParams.keys()].some((key) => key !== "cursor")) return json({ error: "invalid_request" }, 400);
    if (operation === "create" && request.headers.has("origin") && !hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1();
    if (operation === "list") {
      const viewer = await getOptionalDesktopHubProfile(request, database);
      if (!(await musicWorkExists(database, workId))) return json({ error: "not_found" }, 404);
      const page = await listD1MusicPosts(database, workId, viewer?.id ?? null, url.searchParams.get("cursor"));
      return json({ posts: page.posts.map((post) => toClientPost(post)), nextCursor: page.nextCursor });
    }
    const viewer = await requireDesktopHubProfile(request, database);
    if (!(await resolveHubFeatureFlag("social.posting", postingFlags))) return json({ error: "social_posting_disabled" }, 503);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "invalid_request" }, 400);
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["body", "audience"].includes(key))
      || typeof input.body !== "string"
      || (input.audience !== undefined && !["public", "followers"].includes(String(input.audience)))) {
      return json({ error: "invalid_request" }, 400);
    }
    const body = input.body.normalize("NFKC").replace(/\r\n/g, "\n").trim();
    if (body.length > HUB_SOCIAL_POST_MAX_CHARACTERS) return json({ error: "invalid_request" }, 400);
    const audience = input.audience === "followers" ? "followers" : "public";
    if (!(await musicWorkExists(database, workId))) return json({ error: "not_found" }, 404);
    const post = await createD1SocialPost(database, viewer, { body, identityMode: "account", audience, musicWorkId: workId });
    if (audience === "public" && post.authorProfileId) {
      await publishFederatedPost({ profileId: post.authorProfileId, hubPostId: post.id, text: post.body, inReplyToHubPostId: post.replyToPostId });
    }
    return json({ post: toClientPost(post) }, 201);
  } catch (error) {
    if (error instanceof InvalidMusicPostCursorError) return json({ error: "invalid_request" }, 400);
    if (error instanceof SocialPostLinkConflictError) return json({ error: "invalid_request" }, 400);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof HubProfileBlockedError) return json({ error: "blocked" }, 403);
    if (error instanceof RepostCooldownError) return json({ error: "cooldown", retryAt: error.retryAt }, 429);
    if (error instanceof HubPostRateLimitError) {
      return json({ error: "rate_limited", retryAfterSeconds: error.retryAfterSeconds }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    if (error instanceof Error && error.message.startsWith("content_share_")) return json({ error: "invalid_request" }, 400);
    return json({ error: "music_posts_unavailable" }, 503);
  }
}
