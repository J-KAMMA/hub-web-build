import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { feedExpectedViewerError, feedHeaders, feedRequestId } from "@/lib/server/client-feed-operation";
import { readD1SocialPostRequest } from "@/lib/server/d1-social-posts";
import { readScheduledClientRequest } from "@/lib/server/d1-social-scheduled";
import { toClientPost } from "@/lib/client-feed-shape";

/** Read-only reconciliation; the expected viewer is a precondition, never authentication. */
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: feedHeaders });
  if (!hasSameOrigin(request)) return json({ error: "invalid_origin" }, 403);
  if (!request.headers.has("x-hub-expected-viewer")) return json({ error: "feed_operation_invalid_request" }, 400);
  let database; try { database = getHubD1(); } catch { return json({ error: "feed_operation_unavailable" }, 503); }
  let viewer; try { viewer = await requireDesktopHubProfile(request, database); } catch { return json({ error: "unauthorized" }, 401); }
  const mismatch = feedExpectedViewerError(request, viewer.id); if (mismatch) return mismatch;
  const { requestId } = await context.params, url = new URL(request.url), kind = url.searchParams.get("kind");
  if (!feedRequestId(requestId) || !["post", "scheduled"].includes(kind ?? "")
    || [...url.searchParams.keys()].some(key => key !== "kind") || url.searchParams.getAll("kind").length !== 1) {
    return json({ error: "feed_operation_invalid_request" }, 400);
  }
  const clientRequestId = requestId.toLowerCase();
  try {
    const post = kind === "post" ? await readD1SocialPostRequest(database, viewer.id, clientRequestId) : null;
    const scheduled = kind === "scheduled" ? await readScheduledClientRequest(database, viewer.id, clientRequestId) : null;
    return json({ viewerId: viewer.id, clientRequestId, post: post ? { ...toClientPost(post), audience: post.audience } : null, scheduled });
  } catch { return json({ error: "feed_operation_unavailable" }, 503); }
}
