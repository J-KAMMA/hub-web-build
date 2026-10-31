import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { createD1UserList, UserListInputError } from "@/lib/server/d1-user-lists";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けのリスト作成。画面側 /api/lists POST と同じ
 * createD1UserList（20件上限・名前100字など）を通す。
 * 一覧のGETは /api/lists がviewer解決で受けるのでここでは作らない。
 */
export async function POST(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const list = await createD1UserList(database, viewer.id, body ?? {});
    return NextResponse.json({ list }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof UserListInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    throw error;
  }
}
