import { revertRevision } from "@/lib/server/hubpedia-wiki-patrol";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";
import { WikiInputError } from "@/lib/server/hubpedia-wiki";

/* POST { revisionId, reason } - patrol/operator. Publishes the old text as a new revision. -> { revisionId, revisionNumber } */
export const POST = wikiRoute<{ slug: string }>({ write: true }, async ({ request, db, actor, params }) => {
  const body = await readJson(request);
  if (typeof body.revisionId !== "string" || !body.revisionId) throw new WikiInputError("revisionId is required.");
  return revertRevision(db, actor!, params.slug, body.revisionId, body.reason);
});
