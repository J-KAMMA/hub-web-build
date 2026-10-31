import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const { proposalId } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: "accept" | "reject" };
  if (!body.action || !["accept", "reject"].includes(body.action)) return NextResponse.json({ error: "操作が不正です。" }, { status: 400 });
  const database = getHubD1();
  const proposal = await database.prepare(`SELECT game_id, proposed_fields FROM game_guide_edit_proposals WHERE id = ? AND status = 'pending'`).bind(proposalId).first<{ game_id: string; proposed_fields: string }>();
  if (!proposal) return NextResponse.json({ error: "提案が見つかりません。" }, { status: 404 });
  const now = new Date().toISOString();
  if (body.action === "reject") {
    await database.prepare(`UPDATE game_guide_edit_proposals SET status = 'rejected', reviewed_at = ? WHERE id = ?`).bind(now, proposalId).run();
    return NextResponse.json({ ok: true });
  }
  const fields = JSON.parse(proposal.proposed_fields) as Record<string, unknown>;
  const platforms = Array.isArray(fields.platforms) ? JSON.stringify(fields.platforms) : null;
  await database.batch([
    database.prepare(`UPDATE game_guide_hubs SET title = COALESCE(?, title), summary = COALESCE(?, summary), official_url = COALESCE(?, official_url), platforms = COALESCE(?, platforms), release_date = COALESCE(?, release_date), updated_at = ? WHERE id = ?`)
      .bind(fields.title ?? null, fields.summary ?? null, fields.officialUrl ?? null, platforms, fields.releaseDate ?? null, now, proposal.game_id),
    database.prepare(`UPDATE game_guide_edit_proposals SET status = 'accepted', reviewed_at = ? WHERE id = ?`).bind(now, proposalId),
  ]);
  return NextResponse.json({ ok: true });
}
