import { NextResponse } from "next/server";
import { getHubAdsAssets, getHubAdsQuarantine, getHubD1 } from "@/lib/server/hub-d1";
import { recordHubAdScanResult } from "@/lib/server/hub-ads-assets";
import { requireHubAdsScanner } from "@/lib/server/hub-ads-scanner-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireHubAdsScanner(request); if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.result !== "clean" && body.result !== "malicious" && body.result !== "error") || typeof body.provider !== "string") {
    return NextResponse.json({ error: "Invalid scan result." }, { status: 400 });
  }
  const leaseToken = request.headers.get("x-scan-lease-token") ?? "";
  const result = await recordHubAdScanResult(getHubD1(), getHubAdsQuarantine(), getHubAdsAssets(), (await params).id,
    leaseToken, { result: body.result, provider: body.provider });
  return result ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Asset is missing or not pending." }, { status: 409 });
}
