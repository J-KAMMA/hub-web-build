import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { recordHubAdMeasurement } from "@/lib/server/d1-hub-ads";
import { verifyHubAdMeasurementToken } from "@/lib/server/hub-ads-token";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request); if (originError) return originError;
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const payload = typeof body?.token === "string" ? verifyHubAdMeasurementToken(body.token) : null;
  if (!payload) return NextResponse.json({ error: "Invalid measurement token." }, { status: 400 });
  const recorded = await recordHubAdMeasurement(getHubD1(), payload, "rendered", Date.now());
  return NextResponse.json({ recorded }, { headers: { "Cache-Control": "no-store" } });
}
