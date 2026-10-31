import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { listHubpediaCategories, resolveHubpediaCategoryAlias } from "@/lib/server/hubpedia-category-registry";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") ?? "ja";
  const requestedOrder = url.searchParams.get("order");
  const order = requestedOrder === "name" || requestedOrder === "popular" || requestedOrder === "updated"
    ? requestedOrder
    : "articles";
  const requestedId = url.searchParams.get("id");
  const database = getHubD1();
  const categories = await listHubpediaCategories(database, locale, order);
  if (!requestedId) {
    return NextResponse.json({ locale, order, categories }, { headers: publicApiCacheHeaders(request, "hubpedia.category") });
  }
  const canonicalId = await resolveHubpediaCategoryAlias(database, requestedId);
  const category = categories.find((item) => item.id === canonicalId);
  if (!category) return NextResponse.json({ error: "category_not_found" }, { status: 404 });
  return NextResponse.json({
    locale,
    category,
    parents: categories.filter((item) => item.id === category.parentId),
    children: categories.filter((item) => item.parentId === category.id),
  }, { headers: publicApiCacheHeaders(request, "hubpedia.category") });
}
