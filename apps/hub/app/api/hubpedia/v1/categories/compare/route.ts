import { NextResponse } from "next/server";

import { compareHubpediaCategories } from "@/lib/server/hubpedia-category-registry";
import { getHubD1 } from "@/lib/server/hub-d1";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const left = url.searchParams.get("left") ?? "";
  const right = url.searchParams.get("right") ?? "";
  if (!left || !right || left === right) {
    return NextResponse.json({ error: "two_distinct_categories_required" }, { status: 400 });
  }
  const comparison = await compareHubpediaCategories(
    getHubD1(),
    left,
    right,
    url.searchParams.get("locale") ?? "ja",
  );
  if (!comparison) return NextResponse.json({ error: "category_not_found" }, { status: 404 });
  return NextResponse.json({ comparison }, { headers: publicApiCacheHeaders(request, "hubpedia.category") });
}
