import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { isHubEvidenceKind, setItemMaterialOptOut } from "@/lib/server/hubpedia-hub-evidence";

// 投稿ごとに「事典の材料にしない」を切り替える。作者本人だけが操作できる。
// 他人の項目も存在しない項目も同じ403にして、存在を明かさない。
export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  try {
    const body = await request.json() as { kind?: unknown; itemId?: unknown; excluded?: unknown };
    if (
      !isHubEvidenceKind(body.kind)
      || typeof body.itemId !== "string"
      || !body.itemId
      || body.itemId.length > 200
      || typeof body.excluded !== "boolean"
    ) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    }
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const applied = await setItemMaterialOptOut(database, viewer.id, body.kind, body.itemId, body.excluded);
    if (!applied) {
      return NextResponse.json({ error: "この項目は変更できません。" }, { status: 403 });
    }
    return NextResponse.json({ kind: body.kind, itemId: body.itemId, excluded: body.excluded });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "設定を更新できません。しばらくしてから再度お試しください。" }, { status: 503 });
    }
    return NextResponse.json({ error: "設定を更新できませんでした。" }, { status: 400 });
  }
}
