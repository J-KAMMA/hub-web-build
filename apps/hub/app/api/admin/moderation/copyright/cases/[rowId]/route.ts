import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { isCopyrightParty, loadModeratorCase } from "@/lib/server/copyright-case-views";

/* 1件の事件。viewerIsParty は、いまの Hub セッションが投稿者・申告者のとき true（操作は別に拒まれる）。 */
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request, { params }: { params: Promise<{ rowId: string }> }) {
  const denied = requireModerationAdmin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) denied.headers.set(name, value);
    return denied;
  }
  const { rowId } = await params;
  const db = getHubD1();
  const view = await loadModeratorCase(db, rowId);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404, headers: PRIVATE_HEADERS });
  const viewer = await getOptionalHubSessionProfile(request, db).catch(() => null);
  const viewerIsParty = await isCopyrightParty(db, rowId, viewer?.id);
  return NextResponse.json({ case: view, viewerIsParty, now: new Date().toISOString() }, { headers: PRIVATE_HEADERS });
}
