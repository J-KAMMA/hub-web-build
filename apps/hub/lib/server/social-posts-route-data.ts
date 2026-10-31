import "server-only";

import type { SocialPost } from "@/lib/domain";
import { createD1SocialPost, listD1SocialPosts, type CreateD1SocialPostInput } from "@/lib/server/d1-social-posts";
import { safelyIngestVideosFromPublicBody } from "@/lib/server/auto-ingest-post-videos";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

type SocialPosts = SocialPost[];
type CreateSocialPostInput = CreateD1SocialPostInput;

export interface SocialPostsRouteData {
  posts: SocialPosts;
}

export interface CreateSocialPostRouteData {
  post: SocialPost;
}

export class SocialPostScopeError extends Error {
  constructor() { super("social_post_scope_changed"); }
}

// A caller's viewer is a precondition, never authentication.
export function assertExpectedSocialPostViewer(request: Request, viewerId: string) {
  const expected = request.headers.get("X-Hub-Expected-Viewer");
  if (expected !== null && (!expected || expected !== viewerId)) throw new SocialPostScopeError();
}

export async function getSocialPostsRouteData(): Promise<SocialPostsRouteData> {
  const database = getHubD1();
  return { posts: await listD1SocialPosts(database) };
}

export async function createSocialPostRouteData(
  request: Request,
  input: CreateSocialPostInput | CreateD1SocialPostInput
): Promise<CreateSocialPostRouteData> {
  const accountInput = { ...input, identityMode: "account" as const };
  const database = getHubD1();
  const viewer = await requireHubSessionProfile(request, database);
  assertExpectedSocialPostViewer(request, viewer.id);
  const post = await createD1SocialPost(database, viewer, accountInput);
  await safelyIngestVideosFromPublicBody(database, viewer, accountInput.body, {
    identityMode: "account",
    ingestSource: "social_post",
    post: { id: post.id, audience: accountInput.audience ?? "public" }
  });
  return { post };
}
