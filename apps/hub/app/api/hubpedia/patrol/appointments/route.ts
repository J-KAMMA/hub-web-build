import { appointPatrol, listPatrol, revokePatrol } from "@/lib/server/hubpedia-wiki-patrol";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";
import { WikiInputError } from "@/lib/server/hubpedia-wiki";

const profileIdOf = (body: Record<string, unknown>) => {
  if (typeof body.profileId !== "string" || !body.profileId) throw new WikiInputError("profileId is required.");
  return body.profileId;
};

/* GET (patrol/operator) -> { patrol: [{profileId, handle, appointedAt}] } */
export const GET = wikiRoute({}, async ({ db, actor }) => ({ patrol: await listPatrol(db, actor!) }));
/* POST { profileId } - operator only (HUB_OPERATOR_PROFILE_IDS). */
export const POST = wikiRoute({ write: true }, async ({ request, db, actor }) => appointPatrol(db, actor!, profileIdOf(await readJson(request))));
/* DELETE { profileId } - operator only. */
export const DELETE = wikiRoute({ write: true }, async ({ request, db, actor }) => revokePatrol(db, actor!, profileIdOf(await readJson(request))));
