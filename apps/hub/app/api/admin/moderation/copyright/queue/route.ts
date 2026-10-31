import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";
import { listCopyrightQueueItems } from "@/lib/server/copyright-case-views";

/* 運営の著作権の列。締切の早い順。連絡先は Hub に無いので出ない。 */
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) denied.headers.set(name, value);
    return denied;
  }
  const filter = new URL(request.url).searchParams.get("filter");
  const items = await listCopyrightQueueItems(getHubD1(), filter);
  return NextResponse.json({ items, now: new Date().toISOString() }, { headers: PRIVATE_HEADERS });
}
