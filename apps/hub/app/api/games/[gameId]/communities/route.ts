import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { isGameOwner } from "@/lib/server/d1-game-store";

async function isCommunityAdmin(database: ReturnType<typeof getHubD1>, communityId: string, profileId: string) {
  const membership = await database.prepare(`SELECT role FROM community_memberships WHERE community_id = ? AND profile_id = ? AND status = 'active' LIMIT 1`).bind(communityId, profileId).first<{ role: string }>();
  return Boolean(membership && ["owner", "moderator"].includes(membership.role));
}

/**
 * Request a link between a community and a game. A link grants no edit rights until the game's owner has
 * approved it (approved_at). The game's owner linking their own community is approved at once.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = (await request.json().catch(() => ({}))) as { communityId?: string };
  if (!body.communityId) return NextResponse.json({ error: "コミュニティを選んでください。" }, { status: 400 });
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  if (!await isCommunityAdmin(database, body.communityId, actor.id)) return NextResponse.json({ error: "コミュニティ管理者だけが紐付けできます。" }, { status: 403 });
  const game = await database.prepare(`SELECT status FROM game_guide_hubs WHERE id = ? LIMIT 1`).bind(gameId).first<{ status: string }>();
  if (!game || game.status === "rejected") return NextResponse.json({ error: "紐付け可能なゲームが見つかりません。" }, { status: 404 });
  const now = new Date().toISOString();
  const owner = await isGameOwner(database, gameId, actor.id);
  await database.prepare(`INSERT OR IGNORE INTO game_guide_community_links (game_id, community_id, role, linked_at, approved_at) VALUES (?, ?, 'contributor', ?, ?)`)
    .bind(gameId, body.communityId, now, owner ? now : null).run();
  const link = await database.prepare("SELECT approved_at AS approvedAt FROM game_guide_community_links WHERE game_id = ? AND community_id = ?").bind(gameId, body.communityId).first<{ approvedAt: string | null }>();
  return NextResponse.json({ linked: true, approved: Boolean(link?.approvedAt) }, { status: link?.approvedAt ? 200 : 202 });
}

/** The game's owner approves or rejects (removes) a pending community link. */
export async function PATCH(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = (await request.json().catch(() => ({}))) as { communityId?: string; approve?: boolean };
  if (!body.communityId || typeof body.approve !== "boolean") return NextResponse.json({ error: "操作を確認できません。" }, { status: 400 });
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  if (!await isGameOwner(database, gameId, actor.id)) return NextResponse.json({ error: "ゲームの管理者だけが承認できます。" }, { status: 403 });
  const now = new Date().toISOString();
  const result = body.approve
    ? await database.prepare("UPDATE game_guide_community_links SET approved_at = ? WHERE game_id = ? AND community_id = ? AND approved_at IS NULL").bind(now, gameId, body.communityId).run()
    : await database.prepare("DELETE FROM game_guide_community_links WHERE game_id = ? AND community_id = ? AND approved_at IS NULL AND role = 'contributor'").bind(gameId, body.communityId).run();
  if (!(result.meta.changes ?? 0)) return NextResponse.json({ error: "保留中の紐付けが見つかりません。" }, { status: 404 });
  return NextResponse.json({ approved: body.approve });
}
