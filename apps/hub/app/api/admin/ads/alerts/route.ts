import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { evaluateHubAdOperationalAlerts, getHubAdOperationalHealth, listHubAdOperationalAlerts } from "@/lib/server/hub-ads-monitoring";

export async function GET(request: Request) {
  const authError = requireModerationAdmin(request); if (authError) return authError;
  const database = getHubD1();
  return NextResponse.json({ alerts: await listHubAdOperationalAlerts(database), health: await getHubAdOperationalHealth(database) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authError = requireModerationAdmin(request) ?? requireSameOrigin(request); if (authError) return authError;
  const database = getHubD1(); const detected = await evaluateHubAdOperationalAlerts(database);
  return NextResponse.json({ detected: detected.length, alerts: await listHubAdOperationalAlerts(database), health: await getHubAdOperationalHealth(database) }, { headers: { "Cache-Control": "no-store" } });
}
