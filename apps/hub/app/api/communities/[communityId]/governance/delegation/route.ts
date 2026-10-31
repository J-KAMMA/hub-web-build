import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

type Context = { params: Promise<{ communityId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { communityId } = await params;
  try {
    const database = getHubD1(); const actor = await requireHubSessionProfile(request, database);
    const delegation = await database.prepare(`SELECT d.delegate_profile_id AS delegateProfileId,
      p.display_name AS delegateName, d.created_at AS createdAt FROM community_governance_delegations d
      JOIN profiles p ON p.id = d.delegate_profile_id WHERE d.community_id = ? AND d.delegator_profile_id = ?`)
      .bind(communityId, actor.id).first();
    return NextResponse.json({ delegation: delegation ?? null });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "委任設定を取得できませんでした。" }, { status: 400 }); }
}

export async function PUT(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params; const payload = await request.json().catch(() => ({})) as { delegateProfileId?: string | null };
  try {
    const database = getHubD1(); const actor = await requireHubSessionProfile(request, database); const delegate = payload.delegateProfileId;
    if (!delegate) await database.prepare(`DELETE FROM community_governance_delegations WHERE community_id = ? AND delegator_profile_id = ?`).bind(communityId, actor.id).run();
    else {
      if (delegate === actor.id) throw new Error("自分自身には委任できません。");
      const member = await database.prepare(`SELECT 1 AS ok FROM community_memberships WHERE community_id = ? AND profile_id = ? AND status = 'active'`).bind(communityId, delegate).first();
      if (!member) throw new Error("委任先は有効なコミュニティメンバーに限られます。");
      const reverse = await database.prepare(`SELECT 1 AS ok FROM community_governance_delegations WHERE community_id = ? AND delegator_profile_id = ? AND delegate_profile_id = ?`).bind(communityId, delegate, actor.id).first();
      if (reverse) throw new Error("相互委任は設定できません。");
      await database.prepare(`INSERT INTO community_governance_delegations (community_id, delegator_profile_id, delegate_profile_id, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(community_id, delegator_profile_id) DO UPDATE SET delegate_profile_id = excluded.delegate_profile_id, created_at = excluded.created_at`)
        .bind(communityId, actor.id, delegate, new Date().toISOString()).run();
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "委任設定を更新できませんでした。" }, { status: 400 }); }
}
