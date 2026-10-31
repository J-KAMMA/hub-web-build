import { NextResponse } from "next/server";
import { isInstanceOperator } from "@/lib/hub-operators";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

async function requireOperator(request: Request) {
  const database = getHubD1(); const actor = await requireHubSessionProfile(request, database);
  if (!(await isInstanceOperator(database, actor.id, process.env.HUB_OPERATOR_PROFILE_IDS))) throw new Error("Hub運営者だけが利用できます。");
  return { database, actor };
}

export async function GET(request: Request) {
  try {
    const { database } = await requireOperator(request);
    const result = await database.prepare(`SELECT r.community_id AS communityId, c.name, c.description, c.category,
      r.reason, r.created_at AS createdAt, p.display_name AS requesterName
      FROM community_verification_requests r JOIN communities c ON c.id = r.community_id
      JOIN profiles p ON p.id = r.requested_by_profile_id WHERE r.status = 'pending' ORDER BY r.created_at`).all();
    return NextResponse.json({ requests: result.results });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "審査一覧を取得できませんでした。" }, { status: 403 }); }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({})) as { communityId?: string; decision?: string };
  try {
    const { database, actor } = await requireOperator(request);
    const decision = body.decision === "approve" ? "approved" : "rejected"; const status = decision === "approved" ? "verified" : "rejected"; const now = new Date().toISOString();
    await database.batch([
      database.prepare(`UPDATE community_verification_requests SET status = ?, resolved_at = ? WHERE community_id = ? AND status = 'pending'`).bind(decision, now, body.communityId),
      database.prepare(`UPDATE communities SET verification_status = ?, updated_at = ? WHERE id = ?`).bind(status, now, body.communityId),
      database.prepare(`INSERT INTO community_audit_log (id, community_id, actor_profile_id, action, detail, created_at) VALUES (?, ?, ?, 'verification_reviewed', ?, ?)`).bind(crypto.randomUUID(), body.communityId, actor.id, decision, now),
    ]);
    return NextResponse.json({ reviewed: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "審査を完了できませんでした。" }, { status: 403 }); }
}
