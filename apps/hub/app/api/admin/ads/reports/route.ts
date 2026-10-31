import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { listHubAdReports } from "@/lib/server/hub-ads-reporting";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export async function GET(request: Request) {
  const authError = requireModerationAdmin(request);
  if (authError) return authError;
  const daysValue = Number(new URL(request.url).searchParams.get("days") ?? "30");
  const days = Number.isFinite(daysValue) ? daysValue : 30;
  return NextResponse.json(await listHubAdReports(getHubD1(), days), { headers: { "Cache-Control": "no-store" } });
}
