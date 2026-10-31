import { isHumanEditingEnabled } from "@/lib/server/hubpedia-wiki-policy";
import { getEditingStatus } from "@/lib/server/hubpedia-wiki-patrol";
import { wikiRoute } from "@/lib/server/hubpedia-wiki-http";

/* GET -> { humanEditingEnabled, role: "editor"|"patrol"|"operator", trust, suspension: {reason, expiresAt}|null } */
export const GET = wikiRoute({}, async ({ db, actor }) => ({
  humanEditingEnabled: isHumanEditingEnabled(),
  ...(await getEditingStatus(db, actor!.id)),
}));
