import { NextResponse } from "next/server";

import {
  clearOwnGateUnlocks,
  deleteOwnGateUnlock,
  isGateUnlockTargetType,
  listOwnGateUnlocks,
} from "@/lib/server/gate-unlock-library";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

/*
 * 入手した作品 (2026-10-26)。呼び出した本人の行だけを返す・消す。
 *   GET     ?cursor=…        新しい順、鍵で区切る（OFFSET なし）
 *   DELETE  ?type=…&id=…     1件消す
 *   DELETE  ?all=1           すべて消す
 * 他人の ID を渡せる口は無い。profile は常にセッションから決まる。
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET(request: Request) {
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "DB unavailable" }, { status: 503, headers: NO_STORE });
  try {
    const profile = await requireHubSessionProfile(request, database);
    const cursor = new URL(request.url).searchParams.get("cursor");
    return NextResponse.json(await listOwnGateUnlocks(database, profile.id, { cursor }), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
    }
    return NextResponse.json({ error: "読み込めませんでした。" }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "DB unavailable" }, { status: 503, headers: NO_STORE });
  const params = new URL(request.url).searchParams;
  const type = params.get("type") ?? "";
  const id = params.get("id") ?? "";
  const all = params.get("all") === "1";
  if (!all && !(isGateUnlockTargetType(type) && id.length > 0 && id.length <= 200)) {
    return NextResponse.json({ error: "消す作品を指定してください。" }, { status: 400, headers: NO_STORE });
  }
  try {
    const profile = await requireHubSessionProfile(request, database);
    if (all) await clearOwnGateUnlocks(database, profile.id);
    else if (isGateUnlockTargetType(type)) await deleteOwnGateUnlock(database, profile.id, { targetType: type, targetId: id });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
    }
    return NextResponse.json({ error: "消せませんでした。" }, { status: 503, headers: NO_STORE });
  }
}
