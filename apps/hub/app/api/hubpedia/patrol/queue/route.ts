import { listPendingPage } from "@/lib/server/hubpedia-wiki-patrol";
import { wikiRoute } from "@/lib/server/hubpedia-wiki-http";

/* Patrol/operator only. GET ?limit&cursor -> { items: [pending proposals, claim detail included], nextCursor }. */
export const GET = wikiRoute({}, async ({ request, db, actor }) => {
  const url = new URL(request.url);
  return listPendingPage(db, actor!, { limit: Number(url.searchParams.get("limit") ?? 30) || 30, cursor: url.searchParams.get("cursor") });
});
