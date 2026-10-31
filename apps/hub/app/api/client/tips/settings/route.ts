import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOwnTipSettingsForViewer, WalletTipPermissionError } from "@/lib/server/wallet-tips";
export { PATCH } from "../route";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
});
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return json({ error: "invalid_request" }, 400);
    if (request.headers.has("origin") && !hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const settings = await getOwnTipSettingsForViewer(viewer, database, 100), result = { viewerId: viewer.id, ...settings };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024) return json({ error: "tip_settings_unavailable" }, 503);
    return json(result);
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof WalletTipPermissionError) return json({ error: "tip_settings_forbidden" }, 403);
    return json({ error: "tip_settings_unavailable" }, 503);
  }
}
