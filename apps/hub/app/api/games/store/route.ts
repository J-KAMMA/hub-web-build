import { NextResponse } from "next/server";

import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";
import { searchPublicGames } from "@/lib/server/public-game-guides";

/*
 * ゲームストアの公開一覧（Web の /v2/games と同じ searchPublicGames）。Desktop のゲーム画面が読む。
 * 価格は持たない（値があるときだけ画面が出せるよう、この応答にも載せていない）。
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.slice(0, 80) ?? "";
  const platform = params.get("platform")?.slice(0, 40) ?? "";
  try {
    const games = await searchPublicGames(q, platform, { storeOnly: true });
    return NextResponse.json({ games }, { headers: publicApiCacheHeaders(request, "games.catalog") });
  } catch {
    return NextResponse.json({ error: "ゲームを読み込めませんでした。" }, { status: 500 });
  }
}
