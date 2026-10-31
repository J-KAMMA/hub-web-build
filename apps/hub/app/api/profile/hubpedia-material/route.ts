import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { getProfileMaterialOptOut, setProfileMaterialOptOut } from "@/lib/server/hubpedia-hub-evidence";

// 「公開投稿を事典の材料にしない」。既定は材料にする(行なし)。

function failure(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "設定を読み書きできません。しばらくしてから再度お試しください。" }, { status: 503 });
  }
  return NextResponse.json({ error: "設定を更新できませんでした。" }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({ excluded: await getProfileMaterialOptOut(database, viewer.id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  try {
    const body = await request.json() as { excluded?: unknown };
    if (typeof body.excluded !== "boolean") {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    }
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({ excluded: await setProfileMaterialOptOut(database, viewer.id, body.excluded) });
  } catch (error) {
    return failure(error);
  }
}
