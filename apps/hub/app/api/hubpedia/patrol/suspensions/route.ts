import { liftSuspension, suspendEditor } from "@/lib/server/hubpedia-wiki-patrol";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";
import { WikiInputError } from "@/lib/server/hubpedia-wiki";

const profileIdOf = (body: Record<string, unknown>) => {
  if (typeof body.profileId !== "string" || !body.profileId) throw new WikiInputError("profileId is required.");
  return body.profileId;
};

/* POST { profileId, reason, hours (1..720) } - patrol/operator; audit-logged. */
export const POST = wikiRoute({ write: true }, async ({ request, db, actor }) => {
  const body = await readJson(request);
  return suspendEditor(db, actor!, profileIdOf(body), body.reason, body.hours);
});
/* DELETE { profileId, reason } - lifts the active suspension. */
export const DELETE = wikiRoute({ write: true }, async ({ request, db, actor }) => {
  const body = await readJson(request);
  return liftSuspension(db, actor!, profileIdOf(body), body.reason);
});
