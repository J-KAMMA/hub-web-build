import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { listVideoSafetyQueue } from "@/lib/server/hub-video-review";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

/* 自作動画の運営の列：最初の動画の審査待ちと、通報（子どもの性的な内容が先頭）。 */
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) denied.headers.set(name, value);
    return denied;
  }
  return NextResponse.json(await listVideoSafetyQueue(getHubD1()), { headers: PRIVATE_HEADERS });
}
