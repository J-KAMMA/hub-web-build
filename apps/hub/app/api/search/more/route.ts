import { NextRequest, NextResponse } from "next/server";

import { getD1SearchMore, isSearchMoreKind } from "@/lib/server/d1-search-more";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

/*
 * GET /api/search/more?q=...&kind=profiles|posts|threads|hubpedia|communities|articles|games|research|federated[&cursor=...]
 * One kind, keyset-paged (see d1-search-more.ts). The cursor is the last rowid (or an article
 * created_at~id) of public data; it grants nothing, since visibility is re-applied on every page.
 */
const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja").slice(0, 100);
}

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const query = normalize(request.nextUrl.searchParams.get("q") ?? "");
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (!isSearchMoreKind(kind) || !query || (cursor !== null && cursor.length > 300)) {
    return NextResponse.json({ error: "search_more_invalid" }, { status: 400, headers: HEADERS });
  }
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    const page = await getD1SearchMore(database, { kind, query, viewerProfileId: viewer?.id ?? null, cursor });
    return NextResponse.json({ query, ...page, hasMore: Boolean(page.nextCursor) }, { headers: HEADERS });
  } catch {
    /* Fail closed: nothing partial is returned. */
    return NextResponse.json({ error: "search_unavailable" }, { status: 503, headers: HEADERS });
  }
}
