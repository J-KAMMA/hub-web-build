import { NextResponse } from "next/server";

import { HUB_MINIMUM_AGE } from "@/lib/hub-consent";
import { HubAuthInputError, HubHandleConflictError } from "@/lib/server/hub-auth";
import { hasSameOrigin, setHubPasskeyCeremonyCookie } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { beginPasskeyRegistration, HubPasskeyError } from "@/lib/server/hub-passkeys";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "D1を利用できません。" }, { status: 503 });
  const body = await request.json().catch(() => null) as {
    handle?: unknown;
    displayName?: unknown;
    acceptedTerms?: unknown;
    confirmedMinimumAge?: unknown;
  } | null;
  if (!body || typeof body.handle !== "string" || typeof body.displayName !== "string") {
    return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  }
  if (body.acceptedTerms !== true) {
    return NextResponse.json({ error: "利用規約とプライバシーポリシーへの同意が必要です。" }, { status: 400 });
  }
  if (body.confirmedMinimumAge !== true) {
    return NextResponse.json({ error: `${HUB_MINIMUM_AGE}歳以上であることの確認が必要です。` }, { status: 400 });
  }
  try {
    const result = await beginPasskeyRegistration(database, request, {
      handle: body.handle,
      displayName: body.displayName
    });
    const response = NextResponse.json({ options: result.options });
    setHubPasskeyCeremonyCookie(response, request, result.cookieValue, result.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof HubHandleConflictError) {
      return NextResponse.json({ error: "そのユーザーIDは使用されています。" }, { status: 409 });
    }
    if (error instanceof HubAuthInputError || error instanceof HubPasskeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
