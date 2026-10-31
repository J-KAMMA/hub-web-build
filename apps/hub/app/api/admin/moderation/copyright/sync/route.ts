import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { syncExternalTarget } from "@/lib/server/copyright-external";

/*
 * 運営のブラウザが判断を Rights Desk に送ったあと、反映の確認を Hub に頼む。
 * ブラウザの報告は信じない。Hub のサーバーが rights.read を Rights Desk に送り、その答えだけを Hub の表に写す。
 */
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) || requireSameOrigin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) denied.headers.set(name, value);
    return denied;
  }
  const body = await request.json().catch(() => null) as { targetRowId?: unknown } | null;
  if (!body || typeof body.targetRowId !== "string") return NextResponse.json({ error: "invalid_input" }, { status: 400, headers: PRIVATE_HEADERS });
  const result = await syncExternalTarget(getHubD1(), body.targetRowId);
  return NextResponse.json(result, { status: result.ok ? 200 : result.status === 404 ? 404 : 502, headers: PRIVATE_HEADERS });
}
