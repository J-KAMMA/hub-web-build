import { NextResponse } from "next/server";

import { getClientFeed } from "@/lib/server/client-feed-route-data";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";

/**
 * 画面を持たないクライアント（デスクトップ・スマホ）が読むフィード。
 *
 * 読むだけなので同一オリジンは求めない。求めると、ネイティブのクライアントが
 * ブラウザのふりをする必要が出て、締め出しにも防御にもならない。書き込みは
 * これまでどおり同一オリジンを見る。
 */
export async function GET(request: Request) {
  try {
    return NextResponse.json(await getClientFeed(request));
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "feed_unavailable" }, { status: 503 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    throw error;
  }
}
