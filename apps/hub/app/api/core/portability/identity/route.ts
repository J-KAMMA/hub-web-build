import { getIdentityState } from "@/lib/server/account-bundle";
import { portabilityJson, portabilityRoute } from "@/lib/server/portability-route";

/** 公開されている身元（actor URL・公開鍵・別名・移転先）と、この Hub での移転の記録。秘密は含まない。 */
export async function GET(request: Request) {
  return portabilityRoute(request, async ({ database, profile }) => portabilityJson(await getIdentityState(database, profile)));
}
