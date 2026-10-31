import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  AccessGateConflictError,
  AccessGateForbiddenError,
  AccessGateNotFoundError,
  AccessGateValidationError,
} from "@/lib/server/access-gates";
import { HubAuthenticationError } from "@/lib/server/hub-session";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function rejectCrossOrigin(request: Request): NextResponse | null {
  return hasSameOrigin(request)
    ? null
    : NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export function accessGateErrorResponse(error: unknown): NextResponse {
  const json = (message: string, status: number) =>
    NextResponse.json({ error: message }, { status, headers: NO_STORE });
  if (error instanceof HubAuthenticationError) return json("ログインが必要です。", 401);
  if (error instanceof AccessGateValidationError) return json(error.message, 400);
  if (error instanceof AccessGateForbiddenError) return json(error.message, 403);
  if (error instanceof AccessGateNotFoundError) return json(error.message, 404);
  if (error instanceof AccessGateConflictError) return json(error.message, 409);
  return json("門を処理できませんでした。", 503);
}
