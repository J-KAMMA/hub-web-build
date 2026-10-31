import { importAccountBundle } from "@/lib/server/account-bundle";
import { portabilityFailure, portabilityJson, portabilityRoute, readJsonBody } from "@/lib/server/portability-route";

/**
 * 署名済みの束 v2 を、いま入っているこの Hub のアカウントへ取り込む。
 * 1か所でも署名が合わない・禁止項目がある束は、全体を拒む（一部だけ取り込まない）。
 * 取り込んだ投稿は元の日時のまま「移転前の投稿」になり、外部へは配り直さない。
 */
export async function POST(request: Request) {
  return portabilityRoute(request, async ({ database, profile }) => {
    const body = await readJsonBody(request) as { bundle?: unknown; refollow?: unknown } | null;
    if (!body || typeof body !== "object" || !body.bundle) return portabilityJson({ error: "invalid_request" }, 400);
    const result = await importAccountBundle(database, profile, body.bundle, { refollowFollowing: body.refollow !== false });
    if (!result.ok) return portabilityFailure(result);
    return portabilityJson(result.summary, 201);
  });
}
