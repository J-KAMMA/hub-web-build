import { NextResponse } from "next/server";

import { HubAuthenticationError } from "@/lib/server/hub-session";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getActivityUnreadCountsRouteData } from "@/lib/server/notifications-route-data";

const PRIVATE_NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getActivityUnreadCountsRouteData(request), {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, {
        status: 401,
        headers: PRIVATE_NO_STORE_HEADERS,
      });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "Activity count service is unavailable." }, {
        status: 503,
        headers: PRIVATE_NO_STORE_HEADERS,
      });
    }
    throw error;
  }
}
