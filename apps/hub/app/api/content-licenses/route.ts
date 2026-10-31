import { NextResponse } from "next/server";

import {
  ContentLicenseForbiddenError,
  ContentLicenseGateConflictError,
  ContentLicenseValidationError,
  getContentLicense,
  parseContentLicenseTarget,
  setContentLicense,
} from "@/lib/server/content-licenses";
import { NO_STORE, readJson, rejectCrossOrigin } from "@/lib/server/access-gates-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown): NextResponse {
  const json = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: NO_STORE });
  if (error instanceof HubAuthenticationError) return json("ログインが必要です。", 401);
  if (error instanceof ContentLicenseValidationError) return json(error.message, 400);
  if (error instanceof ContentLicenseForbiddenError) return json(error.message, 403);
  if (error instanceof ContentLicenseGateConflictError) return json(error.message, 409);
  return json("ライセンスを処理できませんでした。", 503);
}

/** Public: ?targetType=post|article&targetId=. A work with no row is all rights reserved. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const target = parseContentLicenseTarget(params.get("targetType"), params.get("targetId"));
    const license = await getContentLicense(getHubD1(), target);
    return NextResponse.json({ license }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Author only: { targetType, targetId, license }. CC licenses are refused for gated content. */
export async function PUT(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = await readJson(request);
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new ContentLicenseValidationError("リクエストの形式が正しくありません。");
    }
    const body = input as Record<string, unknown>;
    const saved = await setContentLicense(database, profile.id, { targetType: body.targetType, targetId: body.targetId }, body.license);
    return NextResponse.json({ saved }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
