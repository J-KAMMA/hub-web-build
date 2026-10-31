import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ communityId: string; pageId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, pageId } = await params;
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  const body = (await request.json().catch(() => ({}))) as { gameVersion?: string; difficulty?: string; dlc?: string; modEnvironment?: string; sourceUrl?: string; note?: string };
  if (!body.gameVersion?.trim()) return NextResponse.json({ error: "確認したゲームバージョンを入力してください。" }, { status: 400 });
  const membership = await database.prepare(`SELECT 1 AS ok FROM community_memberships WHERE community_id = ? AND profile_id = ? AND status = 'active'`).bind(communityId, actor.id).first();
  if (!membership) return NextResponse.json({ error: "参加メンバーだけが検証できます。" }, { status: 403 });
  const page = await database.prepare(`SELECT 1 AS ok FROM community_guide_pages WHERE id = ? AND community_id = ?`).bind(pageId, communityId).first();
  if (!page) return NextResponse.json({ error: "攻略ページが見つかりません。" }, { status: 404 });
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO community_guide_verifications (id, page_id, profile_id, game_version, difficulty, dlc, mod_environment, source_url, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), pageId, actor.id, body.gameVersion.trim(), body.difficulty?.trim() || null, body.dlc?.trim() || null, body.modEnvironment?.trim() || null, body.sourceUrl?.trim() || null, body.note?.trim() || null, now),
    database.prepare(`UPDATE community_guide_pages SET verification_status = 'verified', game_version = ?, verified_at = ?, verification_count = verification_count + 1, difficulty = ?, dlc = ?, mod_environment = ?, source_url = ? WHERE id = ? AND community_id = ?`)
      .bind(body.gameVersion.trim(), now, body.difficulty?.trim() || null, body.dlc?.trim() || null, body.modEnvironment?.trim() || null, body.sourceUrl?.trim() || null, pageId, communityId),
  ]);
  return NextResponse.json({ verified: true });
}
