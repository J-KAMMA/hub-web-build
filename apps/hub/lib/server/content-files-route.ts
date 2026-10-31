import { NextResponse } from "next/server";

import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { ContentFileError } from "@/lib/server/content-files";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError } from "@/lib/server/hub-session";

export const NO_STORE = { "Cache-Control": "private, no-store" };

/** Gated file attachments are a jkamma-Hub-only feature (AGENTS.md, 2026-10-15): absent when self-hosted. */
export function rejectContentFileRequest(request: Request, { write }: { write: boolean }): NextResponse | null {
  if (!isOptionalServiceEnabled("vault")) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  if (write && !hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
  }
  return null;
}

export function contentFileErrorResponse(error: unknown): NextResponse {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。", code: "authentication_required" }, { status: 401, headers: NO_STORE });
  }
  if (error instanceof ContentFileError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
  }
  return NextResponse.json({ error: "ファイルを処理できませんでした。", code: "unavailable" }, { status: 503, headers: NO_STORE });
}
