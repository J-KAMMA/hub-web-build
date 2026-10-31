import { reviewProposalAs } from "@/lib/server/hubpedia-wiki-patrol";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";
import { WikiInputError } from "@/lib/server/hubpedia-wiki";

/* POST { decision: "approve" | "reject", note? } - patrol/operator, never on your own proposal.
   -> { status: "approved", revisionId, revisionNumber } | { status: "rejected" } */
export const POST = wikiRoute<{ proposalId: string }>({ write: true }, async ({ request, db, actor, params }) => {
  const body = await readJson(request);
  if (body.decision !== "approve" && body.decision !== "reject") throw new WikiInputError("decision must be approve or reject.");
  return reviewProposalAs(db, actor!, params.proposalId, body.decision === "approve", body.note);
});
