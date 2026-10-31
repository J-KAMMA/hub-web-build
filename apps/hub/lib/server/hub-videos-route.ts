import { NextResponse } from "next/server";

import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { HubVideoError } from "@/lib/server/hub-videos";

export const NO_STORE = { "Cache-Control": "private, no-store" };

/** Self-made videos are a jkamma-Hub-only feature (they need the Video Worker): absent when self-hosted. */
export function rejectNativeVideoRequest(request: Request, { write }: { write: boolean }): NextResponse | null {
  if (!isOptionalServiceEnabled("video")) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  if (write && !hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
  }
  return null;
}

export function nativeVideoErrorResponse(error: unknown): NextResponse {
  if (error instanceof HubAuthenticationError || error instanceof DesktopHubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。", code: "authentication_required" }, { status: 401, headers: NO_STORE });
  }
  if (error instanceof HubVideoError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
  }
  return NextResponse.json({ error: "動画を処理できませんでした。", code: "unavailable" }, { status: 503, headers: NO_STORE });
}
