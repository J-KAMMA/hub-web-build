import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { runHubAdReportingMaintenance } from "@/lib/server/hub-ads-reporting";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const result = await runHubAdReportingMaintenance(getHubD1());
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
