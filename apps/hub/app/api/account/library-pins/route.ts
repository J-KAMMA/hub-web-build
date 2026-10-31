import { NextResponse } from "next/server";

import { isLibraryItemKey, isLibrarySection } from "@/lib/library-column";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { LibraryPinError, setLibraryPin } from "@/lib/server/library-column";

/*
 * 左の列の固定 (2026-10-29)。PUT だけ。本文は { section, key, pinned }。
 * profile は常にセッションから決まる。応答は本人専用で、どこにも保存させない。
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "DB unavailable" }, { status: 503, headers: NO_STORE });
  let body: { section?: unknown; key?: unknown; pinned?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "読み取れませんでした。" }, { status: 400, headers: NO_STORE });
  }
  if (!body || !isLibrarySection(body.section) || !isLibraryItemKey(body.key) || typeof body.pinned !== "boolean") {
    return NextResponse.json({ error: "固定する行の形が正しくありません。" }, { status: 400, headers: NO_STORE });
  }
  try {
    const profile = await requireHubSessionProfile(request, database);
    await setLibraryPin(database, profile.id, body.section, body.key, body.pinned);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
    if (error instanceof LibraryPinError) return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
    return NextResponse.json({ error: "保存できませんでした。" }, { status: 503, headers: NO_STORE });
  }
}
