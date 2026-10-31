import { buildPublicPostEmail } from "@/lib/platform/external-protocols";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getPublicFederationPost } from "@/lib/server/d1-external-protocols";
import { isFederationOptedIn } from "@/lib/server/federation-opt-in";

export async function GET(request: Request, context: { params: Promise<{ postId: string }> }) {
  const { postId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(postId)) {
    return new Response("Invalid post.", { status: 400 });
  }
  const post = await getPublicFederationPost(getHubD1(), postId);
  if (!post || !(await isFederationOptedIn(post.profileId))) return new Response("Not found.", { status: 404 });
  return new Response(buildPublicPostEmail(new URL(request.url).origin, post), {
    headers: {
      "Content-Type": "message/rfc822; charset=utf-8",
      "Content-Disposition": `attachment; filename="hub-post-${post.id}.eml"`,
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
