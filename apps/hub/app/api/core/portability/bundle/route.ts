import { buildBundleDraft } from "@/lib/server/account-bundle";
import { identityGateway } from "@/lib/server/federation-identity-gateway";
import { getHubMedia } from "@/lib/server/hub-d1";
import { portabilityFailure, portabilityJson, portabilityRoute } from "@/lib/server/portability-route";
import { recordPortabilityExport } from "@/lib/server/d1-external-protocols";

/**
 * hub.account.bundle v2 の署名前の下書き。署名は利用者の端末（根鍵）でする。Hub は署名しない。
 * Hub ローカル ID・Account subject・ウォレット・メール・DM は入らない。
 */
export async function GET(request: Request) {
  return portabilityRoute(request, async ({ database, profile }) => {
    let bucket = null;
    try { bucket = getHubMedia(); } catch { /* R2 が無い環境では画像なしで書き出す */ }
    const result = await buildBundleDraft(database, profile, identityGateway, { bucket });
    if (!result.ok) return portabilityFailure(result);
    await recordPortabilityExport(database, profile.id, result.draft.posts.length + result.draft.following.length);
    return portabilityJson({ draft: result.draft, gatedSkipped: result.gatedSkipped }, 200, {
      "content-disposition": `attachment; filename="hub-${profile.handle}-bundle-draft.json"`,
    });
  });
}
