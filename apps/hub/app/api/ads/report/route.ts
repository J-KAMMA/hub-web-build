import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { createHubAdPublicReport, parseHubAdPublicReport } from "@/lib/server/hub-ads-policy";
import { verifyHubAdMeasurementToken } from "@/lib/server/hub-ads-token";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request) {
  const originError = requireSameOrigin(request); if (originError) return originError;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const payload = typeof body?.token === "string" ? verifyHubAdMeasurementToken(body.token) : null;
  if (!payload) return NextResponse.json({ error: "Invalid advertising report." }, { status: 400 });
  const input = parseHubAdPublicReport({ tokenId: payload.tokenId, reasonCode: body?.reasonCode, detail: body?.detail });
  if (!input) return NextResponse.json({ error: "Invalid advertising report." }, { status: 400 });
  const id = await createHubAdPublicReport(getHubD1(), input);
  return NextResponse.json({ id, accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
