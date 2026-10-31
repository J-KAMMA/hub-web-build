import "server-only";

import { NextResponse } from "next/server";

import { ImageBoardInputError } from "@/lib/server/d1-image-boards";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";

export const IMAGE_BOARD_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

export function imageBoardError(error: unknown): NextResponse {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: IMAGE_BOARD_HEADERS });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "ボードを利用できません。しばらくしてから再度お試しください。" }, { status: 503, headers: IMAGE_BOARD_HEADERS });
  }
  if (error instanceof ImageBoardInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: IMAGE_BOARD_HEADERS });
  }
  return NextResponse.json({ error: "ボードを操作できませんでした。" }, { status: 500, headers: IMAGE_BOARD_HEADERS });
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ImageBoardInputError("リクエストの形式が正しくありません。");
}
