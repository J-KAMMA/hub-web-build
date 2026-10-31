import { NextResponse } from "next/server";

import { getNotificationsRouteData } from "@/lib/server/notifications-route-data";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getNotificationsRouteData(request), { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "Notification service is unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}
