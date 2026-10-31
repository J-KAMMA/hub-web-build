import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { findUserArticlePublication, isArticlePublicationRequestId } from "@/lib/server/d1-user-articles";

const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
});

/** An authenticated author's saved operation, independent of present public visibility. */
export async function GET(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    if (new URL(request.url).search) return json({ error: "invalid_request" }, 400);
    if (request.headers.has("origin") && !hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1(), profile = await requireDesktopHubProfile(request, database);
    const { requestId } = await params;
    if (!isArticlePublicationRequestId(requestId)) return json({ error: "invalid_request" }, 400);
    const receipt = await findUserArticlePublication(database, profile.id, requestId);
    return json(receipt ? { found: true, ...receipt, clientRequestId: requestId } : { found: false, clientRequestId: requestId });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    return json({ error: "publication_lookup_failed" }, 500);
  }
}
