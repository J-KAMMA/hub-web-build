import "server-only";
import { getHubD1, HubD1UnavailableError } from "./hub-d1";
import { requireHubSessionProfile, HubAuthenticationError, HubSuspendedError } from "./hub-session";
import { hasSameOrigin } from "./hub-auth-route";
import { ensureD1ThreadPostAvailable } from "./bbs-route-data";
import { readControlInput } from "./client-thread-post-controls";
import { getD1ThreadPostControl, setD1ThreadPostControl, ThreadPostControlError } from "./thread-moderation-repository";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" },
});
export async function webThreadPostControls(request: Request, postId: string, write = false) {
  try {
    if (!postId || postId.length > 128 || /[^A-Za-z0-9_-]/.test(postId) || new URL(request.url).search) return json({ error: "invalid_request" }, 400);
    if ((write || request.headers.has("origin")) && !hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const db = getHubD1(), viewer = await requireHubSessionProfile(request, db);
    if (write) {
      const expected = request.headers.get("x-hub-expected-viewer");
      if (!expected || expected.length > 160 || /\p{Cc}/u.test(expected)) return json({ error: "invalid_request" }, 400);
      if (expected !== viewer.id) return json({ error: "thread_post_actor_changed" }, 409);
    }
    const input = write ? await readControlInput(request) : undefined;
    await ensureD1ThreadPostAvailable(postId);
    const control = input ? await setD1ThreadPostControl(db, postId, input.kind, input.enabled, viewer.id)
      : await getD1ThreadPostControl(db, postId, viewer.id);
    return json({ viewerId: viewer.id, postId, control });
  } catch (error) {
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof HubAuthenticationError) return json({ error: "hub_authentication_failed" }, 401);
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof ThreadPostControlError) return json({ error: error.code }, error.status);
    return json({ error: "thread_post_control_failed" }, 500);
  }
}
