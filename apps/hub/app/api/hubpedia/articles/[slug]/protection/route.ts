import { protectAs } from "@/lib/server/hubpedia-wiki-patrol";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";

/* POST { until: ISO string | null (null unprotects), reason } - patrol/operator. -> { slug, protectedUntil } */
export const POST = wikiRoute<{ slug: string }>({ write: true }, async ({ request, db, actor, params }) => {
  const body = await readJson(request);
  return protectAs(db, actor!, params.slug, (body.until ?? null) as string | null, body.reason);
});
