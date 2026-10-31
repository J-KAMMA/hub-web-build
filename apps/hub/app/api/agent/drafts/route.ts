import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  const db = getHubD1();
  const profile = await getOptionalHubSessionProfile(request, db);
  if (!profile) return Response.json({ error: "authentication_required" }, { status: 401, headers: privateHeaders });
  const result = await db.prepare(`SELECT d.id, d.body, d.destination_type, d.destination_id,
      d.status, d.created_at, g.label AS agent_label, g.source AS agent_source
    FROM hub_agent_drafts d
    JOIN hub_agent_grants g ON g.id = d.grant_id
    WHERE d.profile_id = ? AND d.status IN ('draft', 'approved')
    ORDER BY datetime(d.created_at) DESC LIMIT 50`)
    .bind(profile.id).all();
  return Response.json({ drafts: result.results }, { headers: privateHeaders });
}
