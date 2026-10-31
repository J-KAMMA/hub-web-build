import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { recordSearchOutcome } from "@/lib/server/hubpedia-quality-operations";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const outcomes = new Set(["shown", "clicked", "abandoned"]);
export async function POST(request: Request) {
  const denied = requireSameOrigin(request); if (denied) return denied;
  const body = await request.json().catch(() => null) as null | Record<string, unknown>;
  if (!body || typeof body.query !== "string" || body.query.length > 120 || typeof body.resultCount !== "number" || typeof body.outcome !== "string" || !outcomes.has(body.outcome)) return NextResponse.json({ error: "Invalid search event." }, { status: 400 });
  await recordSearchOutcome(getHubD1(), { query: body.query, resultCount: body.resultCount, clickedSlug: typeof body.clickedSlug === "string" ? body.clickedSlug.slice(0, 100) : null, outcome: body.outcome as "shown"|"clicked"|"abandoned" });
  return new NextResponse(null, { status: 204 });
}
