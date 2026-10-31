import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

const EDITABLE_FIELDS = new Set(["title", "summary", "officialUrl", "platforms", "releaseDate"]);

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const result = await getHubD1().prepare(`SELECT id, proposed_fields, reason, status, created_at, reviewed_at
    FROM game_guide_edit_proposals WHERE game_id = ? AND status = 'accepted' ORDER BY reviewed_at DESC LIMIT 50`)
    .bind(gameId).all();
  return NextResponse.json({ history: result.results ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  const body = (await request.json().catch(() => ({}))) as { fields?: Record<string, unknown>; reason?: string };
  const fields = Object.fromEntries(Object.entries(body.fields ?? {}).filter(([key]) => EDITABLE_FIELDS.has(key)));
  if (!Object.keys(fields).length || !(body.reason?.trim())) return NextResponse.json({ error: "変更内容と理由を入力してください。" }, { status: 400 });
  const game = await database.prepare(`SELECT 1 AS ok FROM game_guide_hubs WHERE id = ? AND status = 'published'`).bind(gameId).first();
  if (!game) return NextResponse.json({ error: "公開中のゲームが見つかりません。" }, { status: 404 });
  await database.prepare(`INSERT INTO game_guide_edit_proposals
    (id, game_id, proposed_fields, reason, status, proposed_by_profile_id, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(crypto.randomUUID(), gameId, JSON.stringify(fields), body.reason.trim().slice(0, 500), actor.id, new Date().toISOString()).run();
  return NextResponse.json({ created: true }, { status: 201 });
}
