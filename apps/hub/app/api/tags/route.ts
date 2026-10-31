import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import {
  listD1PopularContentTags,
  listD1TrendingContentTags,
} from "@/lib/server/d1-content-tags";

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ tags: [] });
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const mode = url.searchParams.get("mode") === "trending" ? "trending" : "popular";
  const requestedLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 20;
  return NextResponse.json(
    {
      mode,
      tags: mode === "trending"
        ? await listD1TrendingContentTags(database, limit)
        : await listD1PopularContentTags(database, limit, query),
    },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
  );
}
