import { NextResponse } from "next/server";

import { DirectMessageError } from "@/lib/server/d1-direct-messages";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import { HubProfileBlockedError } from "@/lib/server/profile-blocks";

export const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function requireDirectMessageMutationOrigin(request: Request) {
  return hasSameOrigin(request)
    ? null
    : NextResponse.json(
        { error: "不正な送信元です。" },
        { status: 403, headers: PRIVATE_RESPONSE_HEADERS },
      );
}

export async function getDirectMessageActor(request: Request) {
  const database = getHubD1();
  const profile = await requireHubSessionProfile(request, database);
  return { database, profile };
}

export function directMessageErrorResponse(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json(
      { error: "ログインが必要です。" },
      { status: 401, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  if (error instanceof DirectMessageError) {
    const headers: Record<string, string> = { ...PRIVATE_RESPONSE_HEADERS };
    if (error.retryAfterSeconds) headers["Retry-After"] = String(error.retryAfterSeconds);
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status, headers },
    );
  }
  if (error instanceof HubProfileBlockedError) {
    return NextResponse.json(
      { error: error.message, code: "profile_blocked" },
      { status: 403, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  return NextResponse.json(
    { error: "メッセージ処理に失敗しました。" },
    { status: 500, headers: PRIVATE_RESPONSE_HEADERS },
  );
}
