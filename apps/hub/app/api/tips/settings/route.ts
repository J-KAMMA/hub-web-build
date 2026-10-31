import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, HubSuspendedError } from "@/lib/server/hub-session";
import {
  getOwnTipSettings, readTipSettingsInput, updateOwnTipSettings,
  WalletTipInputError, WalletTipPermissionError,
} from "@/lib/server/wallet-tips";

const json = (value: unknown, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
});
function failure(error: unknown) {
  if (error instanceof HubSuspendedError) return json({ error: "受取設定を変更できません。" }, 403);
  if (error instanceof HubAuthenticationError) return json({ error: "ログインが必要です。" }, 401);
  if (error instanceof WalletTipInputError) return json({ error: error.message }, 400);
  if (error instanceof WalletTipPermissionError) return json({ error: error.message }, 403);
  return json({ error: "受取設定を利用できません。" }, 503);
}
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return json({ error: "入力を確認してください。" }, 400);
    const database = getOptionalHubD1();
    if (!database) return json({ error: "投げ銭機能を利用できません。" }, 503);
    return json(await getOwnTipSettings(request, database));
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    if (new URL(request.url).search) return json({ error: "入力を確認してください。" }, 400);
    if (!hasSameOrigin(request)) return json({ error: "不正なリクエストです。" }, 403);
    const database = getOptionalHubD1();
    if (!database) return json({ error: "投げ銭機能を利用できません。" }, 503);
    const body = await readTipSettingsInput(request);
    return json(await updateOwnTipSettings({ request, database, address: body.address, chainId: body.chainId,
      enabled: body.enabled, minimumAmount: body.minimumAmount, publishAddress: body.publishAddress }));
  } catch (error) { return failure(error); }
}
