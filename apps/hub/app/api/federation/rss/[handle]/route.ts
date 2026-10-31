import { buildRssFeed } from "@/lib/platform/external-protocols";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  getPublicFederationPosts,
  getPublicFederationProfile,
} from "@/lib/server/d1-external-protocols";
import { isFederationOptedIn } from "@/lib/server/federation-opt-in";

export async function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  const { handle } = await context.params;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,31}$/.test(handle)) {
    return new Response("Invalid handle.", { status: 400 });
  }
  const database = getHubD1();
  const profile = await getPublicFederationProfile(database, handle);
  // A profile that has not opted in to federation looks the same as one that does not exist.
  if (!profile || !(await isFederationOptedIn(profile.id))) return new Response("Not found.", { status: 404 });
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
  const posts = await getPublicFederationPosts(database, profile.id, limit);
  return new Response(buildRssFeed(new URL(request.url).origin, profile, posts), {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
