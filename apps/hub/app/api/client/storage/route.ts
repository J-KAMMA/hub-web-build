import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { readHubStorageStatus } from "@/lib/server/hub-storage-status";

// デスクトップ用の保存容量の読み出し。Web 版（/api/account/storage）と同じ中身。
export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };
const unavailable = () => NextResponse.json({ error: "unavailable" }, { status: 503, headers });

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const body = await readHubStorageStatus(database, viewer.id);
    return body ? NextResponse.json(body, { headers }) : unavailable();
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    return unavailable();
  }
}
