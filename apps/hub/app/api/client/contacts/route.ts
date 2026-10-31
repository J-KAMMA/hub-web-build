import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { listD1ContactProfiles } from "@/lib/server/messages-page-data";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けの連絡先。フォロー関係にあるプロフィールの一覧で、
 * 組み立てはメッセージ画面と同じ messages-page-data に任せる——
 * 画面とアプリで違う連絡先が見えると会話の相手が揃わない。
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json(
      { contacts: await listD1ContactProfiles(database, viewer.id) },
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
