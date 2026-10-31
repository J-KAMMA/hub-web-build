import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function DELETE(request: Request, context: { params: Promise<{ grantId: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const db = getHubD1();
  const profile = await requireHubSessionProfile(request, db);
  const { grantId } = await context.params;
  await db.prepare(`UPDATE hub_agent_grants SET revoked_at = ?
    WHERE id = ? AND profile_id = ? AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), grantId, profile.id).run();
  return new Response(null, { status: 204 });
}
