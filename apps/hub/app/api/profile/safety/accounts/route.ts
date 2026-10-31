import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { listD1ProfileControlPage } from "@/lib/server/profile-public-details";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

/*
 * 自分がブロック／ミュートした相手の一覧（頁送り）。本人のセッションの行だけを返し、
 * 相手の画面やほかの人には出ない。解除は既存の PATCH /api/profile/safety を使う。
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    if (kind !== "blocked" && kind !== "muted") {
      return NextResponse.json({ error: "種類を確認してください。" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const page = await listD1ProfileControlPage(database, viewer.id, kind, { cursor: url.searchParams.get("cursor") });
    return NextResponse.json(page, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "一覧を取得できません。しばらくしてから再度お試しください。" }, { status: 503, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ error: "一覧を取得できませんでした。" }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
