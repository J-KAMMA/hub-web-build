import { NextResponse } from "next/server";
import { listAnchoredDiscussion, parseAnchor, postAnchoredDiscussion } from "@/lib/server/hubpedia-wiki-annotations";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";

type Params = { slug: string; anchorType: string; anchorId: string };

/* GET (public) -> { comments: [{id, parentId, body, createdAt, authorHandle}] } for one claim or paragraph. */
export const GET = wikiRoute<Params>({ auth: false }, async ({ db, params }) => ({
  comments: await listAnchoredDiscussion(db, params.slug, parseAnchor(params.anchorType, params.anchorId)),
}));
/* POST { body, parentId? } -> 201 { id, createdAt }. Suspended editors are blocked. */
export const POST = wikiRoute<Params>({ write: true }, async ({ request, db, actor, params }) => {
  const body = await readJson(request);
  return NextResponse.json(
    await postAnchoredDiscussion(db, actor!, params.slug, parseAnchor(params.anchorType, params.anchorId), body.body, body.parentId),
    { status: 201 },
  );
});
