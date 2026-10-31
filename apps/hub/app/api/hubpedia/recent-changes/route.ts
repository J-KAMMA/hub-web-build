import { listRecentChanges } from "@/lib/server/hubpedia-wiki-patrol";
import { wikiRoute } from "@/lib/server/hubpedia-wiki-http";

/* GET ?limit=30&cursor=...&authorKind=ai|human|hybrid -> { items: [...], nextCursor } (public, keyset-paged). */
export const GET = wikiRoute({ auth: false }, async ({ request, db }) => {
  const url = new URL(request.url);
  return listRecentChanges(db, {
    limit: Number(url.searchParams.get("limit") ?? 30) || 30,
    cursor: url.searchParams.get("cursor"),
    authorKind: url.searchParams.get("authorKind"),
  });
});
