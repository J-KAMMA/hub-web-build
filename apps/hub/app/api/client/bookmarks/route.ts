import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { getBookmarksPageDataForViewer } from "@/lib/server/bookmarks-page-data";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けのブックマーク一覧。組み立ては画面側と同じ
 * bookmarks-page-data に任せる——ここで独自にSQLを書くと、
 * 画面とアプリで違う一覧が見える。
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const data = await getBookmarksPageDataForViewer(database, viewer);
    return NextResponse.json(
      { items: data.items },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    throw error;
  }
}
