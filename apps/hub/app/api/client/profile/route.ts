import { NextResponse } from "next/server";

import { parsePseudonymousProfileUpdate } from "@/lib/profile-privacy";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { updateD1CurrentProfileRouteData } from "@/lib/server/profile-route-data";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けのプロフィール編集（表示名・bio）。画面側
 * PATCH /api/profile と同じ parsePseudonymousProfileUpdate と
 * updateD1CurrentProfileRouteData を通す。handle・アバター・
 * 外部リンクの変更はWebの設定面の仕事に留める。
 */
export async function PATCH(request: Request) {
  try {
    const input = parsePseudonymousProfileUpdate(await request.json());
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json(
      await updateD1CurrentProfileRouteData(database, viewer.id, input),
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 400 },
    );
  }
}
