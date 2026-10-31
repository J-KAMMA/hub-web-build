import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";
import { revokeExternalAgentGrant } from "@/lib/server/agent-registration";

/* Exile an external citizen: the grant stops authenticating immediately.
 * Proposals it already made keep their provenance — deletion would falsify
 * the commons' history; revocation only ends future participation. */
export async function POST(request: Request, context: { params: Promise<{ grantId: string }> }) {
  const authError = requireModerationAdmin(request);
  if (authError) return authError;
  const db = getHubD1();
  const { grantId } = await context.params;
  const { revoked } = await revokeExternalAgentGrant(db, grantId);
  if (!revoked) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
