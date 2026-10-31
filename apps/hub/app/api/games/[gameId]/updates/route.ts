import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { canManageGame } from "@/lib/server/d1-game-store";

export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = (await request.json().catch(() => ({}))) as { versionLabel?: string; title?: string; officialUrl?: string; releasedAt?: string };
  const version = body.versionLabel?.trim() ?? "";
  const title = body.title?.trim() ?? "";
  if (!version || !title || !/^\d{4}-\d{2}-\d{2}$/.test(body.releasedAt ?? "")) return NextResponse.json({ error: "アップデート情報を確認してください。" }, { status: 400 });
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  const manager = await canManageGame(database, gameId, actor.id);
  if (!manager) return NextResponse.json({ error: "紐付いたコミュニティの管理者だけが更新できます。" }, { status: 403 });
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO game_guide_updates (id, game_id, version_label, title, official_url, released_at, created_by_profile_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), gameId, version, title, body.officialUrl?.trim() || null, body.releasedAt, actor.id, now),
    database.prepare(`UPDATE community_guide_pages SET verification_status = 'recheck_required' WHERE community_id IN (SELECT community_id FROM game_guide_community_links WHERE game_id = ? AND approved_at IS NOT NULL)`).bind(gameId),
  ]);
  return NextResponse.json({ created: true, guidesMarkedForRecheck: true }, { status: 201 });
}
