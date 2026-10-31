import { NextResponse } from "next/server";

import { NO_STORE, readJson, rejectCrossOrigin } from "@/lib/server/access-gates-route";
import { ContentDownloadError, parseDownloadTarget, readDownloadPolicy, setDownloadPolicy } from "@/lib/server/content-downloads";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
  if (error instanceof ContentDownloadError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  return NextResponse.json({ error: "ダウンロードの設定を処理できませんでした。" }, { status: 503, headers: NO_STORE });
}

/** Public: ?targetType=post|article|video&targetId=. No saved row means "none". */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const target = parseDownloadTarget(params.get("targetType"), params.get("targetId"));
    const setting = await readDownloadPolicy(getHubD1(), target);
    return NextResponse.json(setting, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Author only: { targetType, targetId, policy }. */
export async function PUT(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = await readJson(request);
    const body = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const saved = await setDownloadPolicy(database, profile.id, { targetType: body.targetType, targetId: body.targetId }, body.policy);
    return NextResponse.json({ saved }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
