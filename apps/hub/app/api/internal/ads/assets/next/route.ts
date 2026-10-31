import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { claimHubAdScan } from "@/lib/server/hub-ads-assets";
import { requireHubAdsScanner } from "@/lib/server/hub-ads-scanner-auth";

export async function POST(request: Request) {
  const denied = requireHubAdsScanner(request); if (denied) return denied;
  const job = await claimHubAdScan(getHubD1());
  return job ? NextResponse.json(job, { headers: { "Cache-Control": "no-store" } })
    : new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
