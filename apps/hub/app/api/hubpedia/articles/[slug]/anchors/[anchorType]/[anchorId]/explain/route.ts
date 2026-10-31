import { localExplainerFromEnv, parseAnchor, requestExplanation } from "@/lib/server/hubpedia-wiki-annotations";
import { wikiRoute } from "@/lib/server/hubpedia-wiki-http";

type Params = { slug: string; anchorType: string; anchorId: string };

/* POST (signed in) -> { status: "queued", requestId, note } normally;
   { status: "ready", requestId, explanation } only when a loopback local model is configured
   (HUBPEDIA_LOCAL_MODEL_URL + HUBPEDIA_LOCAL_MODEL_NAME). No paid model is ever called. */
export const POST = wikiRoute<Params>({ write: true }, async ({ db, actor, params }) =>
  requestExplanation(db, actor!, params.slug, parseAnchor(params.anchorType, params.anchorId), { localModel: localExplainerFromEnv() }),
);
