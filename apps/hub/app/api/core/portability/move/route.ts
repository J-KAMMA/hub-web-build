import { defaultRefollow, moveAccountOut } from "@/lib/server/account-bundle";
import { portabilityFailure, portabilityJson, portabilityRoute, readJsonBody } from "@/lib/server/portability-route";

/**
 * 協力的な移転。新しい家の actor が alsoKnownAs に、いまの actor を載せていることが前提。
 * 成功すると、この Hub は Move を followers へ配り、プロフィールページを12か月間、新しい家へ永続リダイレクトする。
 */
export async function POST(request: Request) {
  return portabilityRoute(request, async ({ database, profile }) => {
    const body = await readJsonBody(request, 64 * 1024) as { target?: unknown; move?: unknown } | null;
    if (!body || typeof body.target !== "string" || body.target.length > 2048) return portabilityJson({ error: "invalid_request" }, 400);
    const refollow = defaultRefollow(database);
    const result = await moveAccountOut(
      database,
      profile,
      { target: body.target, ...(body.move && typeof body.move === "object" ? { move: body.move as object } : {}) },
      { localRefollow: refollow },
    );
    if (!result.ok) return portabilityFailure(result);
    return portabilityJson({
      movedTo: result.movedTo, notified: result.notified, redirectUntil: result.redirectUntil, localFollowersMoved: result.localFollowersMoved,
    });
  });
}
