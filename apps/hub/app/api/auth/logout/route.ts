import { NextResponse } from "next/server";

import { clearHubSessionCookie, hasSameOrigin, revokeHubSession } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  const database = getOptionalHubD1();
  if (database) await revokeHubSession(request, database);
  const response = NextResponse.json({ ok: true });
  clearHubSessionCookie(response, request);
  return response;
}
