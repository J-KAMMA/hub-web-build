import { NextResponse } from "next/server";

import { HubAuthInputError } from "@/lib/server/hub-auth";
import { hasSameOrigin, setHubPasskeyCeremonyCookie } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { beginPasskeyAuthentication, HubPasskeyError } from "@/lib/server/hub-passkeys";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "D1を利用できません。" }, { status: 503 });
  const body = await request.json().catch(() => null) as { handle?: unknown } | null;
  if (!body || typeof body.handle !== "string") {
    return NextResponse.json({ error: "ユーザーIDを入力してください。" }, { status: 400 });
  }
  try {
    const result = await beginPasskeyAuthentication(database, request, { handle: body.handle });
    const response = NextResponse.json({ options: result.options });
    setHubPasskeyCeremonyCookie(response, request, result.cookieValue, result.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof HubAuthInputError || error instanceof HubPasskeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
