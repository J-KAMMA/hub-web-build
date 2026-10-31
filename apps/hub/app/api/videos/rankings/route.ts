import { NextResponse } from "next/server";

import { listD1VideoRankings } from "@/lib/server/d1-video-library";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

export async function GET() {
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "動画ランキングを取得できませんでした。" }, { status: 503 });
  }
  const rankings = await listD1VideoRankings(database);
  return NextResponse.json(rankings);
}
