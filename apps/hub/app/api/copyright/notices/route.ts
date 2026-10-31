import { NextResponse } from "next/server";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { CopyrightCaseError, createHubUserCase } from "@/lib/server/copyright-cases";

/*
 * Hub にログインした人の著作権の申告（経路 hub-login）。事件の表（copyright_cases）に書く。
 * 旧い copyright_notices は読むだけ。連絡先は取らない（Rights Desk の役目）。
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  try {
    const profile = await requireHubSessionProfile(request, db);
    const body = await request.json() as Record<string, unknown>;
    const created = await createHubUserCase(db, {
      reporter: { id: profile.id, displayName: profile.displayName },
      targetType: body.targetType,
      targetId: body.targetId,
      workDescription: body.workDescription,
      claimBasis: body.claimBasis,
    });
    return NextResponse.json({ submitted: true, caseNumber: created.caseNumber }, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof CopyrightCaseError) {
      const status = error.code === "rate_limited" ? 429 : error.code === "target_not_found" ? 404 : error.code === "duplicate" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
