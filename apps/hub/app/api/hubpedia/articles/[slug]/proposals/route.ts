import { NextResponse } from "next/server";
import { submitClaimProposal } from "@/lib/server/hubpedia-claim-proposals";
import { submitWikiProposal } from "@/lib/server/hubpedia-wiki";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";

/*
 * Human editing of a Hubpedia article. Off unless HUBPEDIA_HUMAN_EDITING=1 (on in local dev).
 *
 * Body for a whole-article edit:  { title, summary?, bodyMarkdown, editSummary, baseRevisionKey, sources? }
 * Body for a claim-level edit:    { kind: "add_claim" | "modify_claim" | "add_evidence" | "add_refuting_evidence",
 *   editSummary, baseRevisionKey, claimId?, statement?, replaceText?, insertAfter?,
 *   evidence?: { type: "source", url, quote? } | { type: "hub_item", hubKind, itemId } }
 * Response 201: { id, status: "pending" | "approved", lane, risk, createdAt } (instant lane also returns revisionId).
 */
export const POST = wikiRoute<{ slug: string }>({ write: true, requireFlag: true }, async ({ request, db, actor, params }) => {
  const body = await readJson(request);
  const input = { ...body, slug: params.slug };
  const result = typeof body.kind === "string" ? await submitClaimProposal(db, actor!, input) : await submitWikiProposal(db, actor!, input);
  return NextResponse.json(result, { status: 201 });
});
