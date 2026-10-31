import { NextResponse } from "next/server";
import { advertiserSessionFromRequest } from "@/lib/server/hub-ads-advertiser-session";
import { getHubD1 } from "@/lib/server/hub-d1";
import { createHubAdAppeal, parseHubAdAppeal } from "@/lib/server/hub-ads-policy";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request); if (originError) return originError;
  const session = advertiserSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const input = parseHubAdAppeal({ ...body, advertiserRef: session.advertiserRef });
  if (!input) return NextResponse.json({ error: "invalid_appeal" }, { status: 400 });
  const id = await createHubAdAppeal(getHubD1(), input);
  return id ? NextResponse.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "advertiser_not_ready" }, { status: 409 });
}
