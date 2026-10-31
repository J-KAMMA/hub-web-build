import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  if (!hasSameOrigin(request)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const db = getHubD1();
  const profile = await getOptionalHubSessionProfile(request, db);
  if (!profile) return Response.json({ error: "authentication_required" }, { status: 401 });
  const { draftId } = await context.params;
  const result = await db.prepare(`UPDATE hub_agent_drafts SET status='approved', approved_at=?
    WHERE id=? AND profile_id=? AND status='draft'`)
    .bind(new Date().toISOString(), draftId, profile.id).run();
  return Response.json({ approved: Number(result.meta.changes ?? 0) === 1 });
}
