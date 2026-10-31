import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { isNavItemType, saveNavOrder, type NavOrderEntry } from "@/lib/server/v2-nav-registered";
import { NAV_ORDER_MAX } from "@/lib/v2-feed-nav";

/*
 * 登録の行の並び (2026-10-27)。PUT だけ。本文は [{type,id}, …] の並び順（最大 200）。
 * profile は常にセッションから決まる。本人のものでない行・無い行は黙って捨てる。
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function parseEntries(body: unknown): NavOrderEntry[] | null {
  if (!Array.isArray(body) || body.length > NAV_ORDER_MAX) return null;
  const entries: NavOrderEntry[] = [];
  for (const raw of body) {
    if (!raw || typeof raw !== "object") return null;
    const { type, id } = raw as { type?: unknown; id?: unknown };
    if (!isNavItemType(type) || typeof id !== "string" || id.length < 1 || id.length > 200) return null;
    entries.push({ type, id });
  }
  return entries;
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "DB unavailable" }, { status: 503, headers: NO_STORE });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "並びを読み取れませんでした。" }, { status: 400, headers: NO_STORE });
  }
  const entries = parseEntries(body);
  if (!entries) return NextResponse.json({ error: "並びの形が正しくありません。" }, { status: 400, headers: NO_STORE });
  try {
    const profile = await requireHubSessionProfile(request, database);
    const saved = await saveNavOrder(database, profile.id, entries);
    return NextResponse.json({ ok: true, saved }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
    }
    return NextResponse.json({ error: "保存できませんでした。" }, { status: 503, headers: NO_STORE });
  }
}
