import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubpediaResearchWork } from "@/lib/server/hubpedia-research-knowledge";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = await getHubpediaResearchWork(getHubD1(), id).catch(() => null);
  return work
    ? NextResponse.json(work, { headers: { ...publicApiCacheHeaders(request, "hubpedia.article"), "x-content-type-options": "nosniff" } })
    : NextResponse.json({ error: "Research work not found." }, { status: 404 });
}
