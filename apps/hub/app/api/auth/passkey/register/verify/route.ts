import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";

import { HubHandleConflictError } from "@/lib/server/hub-auth";
import {
  clearHubPasskeyCeremonyCookie,
  hasSameOrigin,
  setHubSessionCookie
} from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { finishPasskeyRegistration, HubPasskeyError } from "@/lib/server/hub-passkeys";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "D1を利用できません。" }, { status: 503 });
  const body = await request.json().catch(() => null) as RegistrationResponseJSON | null;
  if (!body || typeof body.id !== "string" || body.type !== "public-key") {
    return NextResponse.json({ error: "パスキー応答を確認できません。" }, { status: 400 });
  }
  try {
    const result = await finishPasskeyRegistration(database, request, body);
    const response = NextResponse.json({ profile: result.profile }, { status: 201 });
    clearHubPasskeyCeremonyCookie(response, request);
    setHubSessionCookie(response, request, result.sessionSecret, result.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof HubHandleConflictError) {
      return NextResponse.json({ error: "そのユーザーIDは使用されています。" }, { status: 409 });
    }
    if (error instanceof HubPasskeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
