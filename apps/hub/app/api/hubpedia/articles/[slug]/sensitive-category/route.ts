import { setSensitiveCategoryAs } from "@/lib/server/hubpedia-wiki-patrol";
import { readJson, wikiRoute } from "@/lib/server/hubpedia-wiki-http";

/* POST { category: "medical" | "legal" | "financial" | null } - patrol/operator. Sensitive entries always need human review. */
export const POST = wikiRoute<{ slug: string }>({ write: true }, async ({ request, db, actor, params }) => {
  const body = await readJson(request);
  return setSensitiveCategoryAs(db, actor!, params.slug, body.category ?? null);
});
