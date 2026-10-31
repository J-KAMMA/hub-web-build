import { NextResponse } from "next/server";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { canManageGame } from "@/lib/server/d1-game-store";
import { storeGameImage } from "@/lib/server/game-image-storage";

const RIGHTS = new Set(["official_permission", "user_created", "licensed"]);
export async function PATCH(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  const manager = await canManageGame(database, gameId, actor.id);
  if (!manager) return NextResponse.json({ error: "連携コミュニティの管理者だけが変更できます。" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { imageDataUrl?: unknown; rightsBasis?: string; attribution?: string };
  if (!RIGHTS.has(body.rightsBasis ?? "")) return NextResponse.json({ error: "画像の利用根拠を選択してください。" }, { status: 400 });
  if (body.rightsBasis !== "user_created" && !body.attribution?.trim()) return NextResponse.json({ error: "権利者または出典を入力してください。" }, { status: 400 });
  const stored = await storeGameImage(getHubMedia(), gameId, body.imageDataUrl);
  await database.prepare(`UPDATE game_guide_hubs SET image_url = ?, image_rights_basis = ?, image_attribution = ?, updated_at = ? WHERE id = ?`).bind(stored.imageUrl, body.rightsBasis, body.attribution?.trim() || null, new Date().toISOString(), gameId).run();
  return NextResponse.json({ imageUrl: stored.imageUrl });
}
