import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError, HubSuspendedError } from "@/lib/server/hub-session";
import { getClientSidebarPage, parseSidebarKind, SidebarRequestError } from "@/lib/server/client-sidebar";

/** 内側左列（フォロー中のタグと登録チャンネル）。本人だけ。続きは cursor のパスで。 */
export async function sidebarResponse(request: Request, kind: string, cursor: string | null) {
  try {
    const parsed = parseSidebarKind(kind);
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    return NextResponse.json(await getClientSidebarPage(database, viewer.id, parsed, cursor), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof SidebarRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403 });
    if (error instanceof DesktopHubAuthenticationError || error instanceof HubAuthenticationError) return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    throw error;
  }
}
