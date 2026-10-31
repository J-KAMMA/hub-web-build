import { sendSelfSignedMove } from "@/lib/server/account-bundle";
import { portabilityFailure, portabilityJson, portabilityRoute, readJsonBody } from "@/lib/server/portability-route";

/**
 * 旧 Hub に頼らない移転。利用者の端末が根鍵で署名した Move を受け取り、取り込んだ束にあったフォロワーへ配る。
 * 受け取った Hub は、以前に取得して固定していた旧 actor の根鍵と一致するときだけ受け付ける。
 */
export async function POST(request: Request) {
  return portabilityRoute(request, async ({ database, profile }) => {
    const body = await readJsonBody(request, 256 * 1024) as { move?: unknown } | null;
    if (!body?.move) return portabilityJson({ error: "invalid_request" }, 400);
    const result = await sendSelfSignedMove(database, profile, body.move);
    return result.ok ? portabilityJson({ delivered: result.delivered }, 202) : portabilityFailure(result);
  });
}
