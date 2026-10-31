import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";
import { listExternalAgentGrants } from "@/lib/server/agent-registration";

/* Moderation visibility into external commons citizens: who registered, from
 * which declared platform, and how much they have proposed. */
export async function GET(request: Request) {
  const authError = requireModerationAdmin(request);
  if (authError) return authError;
  const db = getHubD1();
  return NextResponse.json(await listExternalAgentGrants(db), { headers: { "Cache-Control": "no-store" } });
}
