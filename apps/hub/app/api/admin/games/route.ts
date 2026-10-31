import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request); if (denied) return denied;
  const database = getHubD1();
  const [result, proposals] = await Promise.all([
  database.prepare(`SELECT id, slug, title, summary, official_url, platforms, release_date, status, created_at
    FROM game_guide_hubs WHERE status = 'pending' ORDER BY created_at`).all(),
  database.prepare(`SELECT e.id, e.game_id, e.proposed_fields, e.reason, e.created_at, g.title AS game_title
    FROM game_guide_edit_proposals e JOIN game_guide_hubs g ON g.id = e.game_id
    WHERE e.status = 'pending' ORDER BY e.created_at`).all()
  ]);
  return NextResponse.json({ games: result.results ?? [], proposals: proposals.results ?? [] });
}

export async function PATCH(request: Request) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request); if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { gameId?: string; action?: string; targetGameId?: string };
  if (!body.gameId || !["publish", "reject", "merge"].includes(body.action ?? "")) return NextResponse.json({ error: "操作を確認できません。" }, { status: 400 });
  const database = getHubD1(); const now = new Date().toISOString();
  if (body.action === "merge") {
    if (!body.targetGameId || body.targetGameId === body.gameId) return NextResponse.json({ error: "統合先を選んでください。" }, { status: 400 });
    await database.batch([
      database.prepare(`INSERT OR IGNORE INTO game_guide_community_links (game_id, community_id, role, linked_at, approved_at)
        SELECT ?, community_id, role, ?, approved_at FROM game_guide_community_links WHERE game_id = ?`).bind(body.targetGameId, now, body.gameId),
      database.prepare(`UPDATE game_guide_hubs SET status = 'rejected', reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).bind(now, now, body.gameId),
    ]);
  } else {
    await database.prepare(`UPDATE game_guide_hubs SET status = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
      .bind(body.action === "publish" ? "published" : "rejected", now, now, body.gameId).run();
  }
  return NextResponse.json({ ok: true });
}
