import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getClientSubscriptions } from "@/lib/server/client-sidebar";

/** 登録チャンネルの新着（動画・音楽）。本人だけ。 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "videos" && kind !== "music") return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json(await getClientSubscriptions(database, viewer.id, kind), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403 });
    if (error instanceof DesktopHubAuthenticationError) return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    throw error;
  }
}
