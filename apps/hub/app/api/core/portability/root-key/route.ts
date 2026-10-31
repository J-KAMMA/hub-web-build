import { registerRootKey, removeRootKey } from "@/lib/server/account-bundle";
import { portabilityFailure, portabilityJson, portabilityRoute, readJsonBody } from "@/lib/server/portability-route";

/**
 * 根鍵の公開。利用者の端末が根鍵で署名した登録文だけを受け取り、公開鍵を actor の assertionMethod に載せる。
 * 秘密鍵は届かない（届いたら拒む）。根鍵はログイン資格にも、ウォレット鍵にも、Identity の assertion にも使わない。
 */
export async function PUT(request: Request) {
  return portabilityRoute(request, async ({ database, profile }) => {
    const body = await readJsonBody(request, 64 * 1024) as { statement?: unknown } | null;
    if (!body?.statement) return portabilityJson({ error: "invalid_request" }, 400);
    const result = await registerRootKey(database, profile, body.statement);
    return result.ok ? portabilityJson({ rootKey: result.rootKey, actor: result.actor }) : portabilityFailure(result);
  });
}

export async function DELETE(request: Request) {
  return portabilityRoute(request, async ({ database, profile }) => {
    const result = await removeRootKey(database, profile);
    return result.ok ? portabilityJson({ removed: true }) : portabilityFailure(result);
  });
}
