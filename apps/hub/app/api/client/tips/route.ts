import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  getOwnTipSettingsForViewer, listOwnWalletTipsForViewer, readTipSettingsInput, updateOwnTipSettingsForViewer,
  WalletTipInputError, WalletTipPermissionError, WalletTipVerificationError,
} from "@/lib/server/wallet-tips";

const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
});
function failure(error: unknown, reading = false) {
  if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
  if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
  if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
  if (error instanceof WalletTipInputError) return json({ error: reading ? "tip_settings_unavailable" : "invalid_tip_settings" }, reading ? 503 : 400);
  if (error instanceof WalletTipPermissionError) return json({ error: "tip_settings_forbidden" }, 403);
  if (error instanceof WalletTipVerificationError) return json({ error: "tip_settings_unavailable" }, 503);
  return json({ error: reading ? "tip_settings_unavailable" : "update_failed" }, reading ? 503 : 500);
}
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return json({ error: "invalid_request" }, 400);
    if (request.headers.has("origin") && !hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const [settings, history] = await Promise.all([
      getOwnTipSettingsForViewer(viewer, database), listOwnWalletTipsForViewer(viewer, database),
    ]);
    return json({ viewerId: viewer.id, ...settings, links: settings.links.map(({ visibility: _visibility, ...link }) => link), ...history });
  } catch (error) { return failure(error, true); }
}
export async function PATCH(request: Request) {
  try {
    if (new URL(request.url).search) return json({ error: "invalid_request" }, 400);
    if (!hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const body = await readTipSettingsInput(request, true);
    const result = await updateOwnTipSettingsForViewer({ request, database, profile: viewer,
      address: body.address, chainId: body.chainId, enabled: body.enabled, minimumAmount: body.minimumAmount, publishAddress: body.publishAddress });
    return json({ viewerId: viewer.id, ...result });
  } catch (error) { return failure(error); }
}
