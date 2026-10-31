import { NextResponse } from "next/server";

import { rejectResearchToken } from "@/lib/server/research-token-flag";

import { NO_STORE, rejectCrossOrigin } from "@/lib/server/access-gates-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { ensureResearchSupporterGate, ResearchTokenError, type ResearchTokenFailure } from "@/lib/server/research-project-token";

export const dynamic = "force-dynamic";

const FAILURES: Record<ResearchTokenFailure, [number, string]> = {
  research_not_found: [404, "研究プロジェクトが見つかりません。"],
  research_forbidden: [403, "オーナーだけが使えます。"],
  invalid_input: [400, "このトークンでは支援者向けの鍵を作れません。"],
  unsupported_chain: [400, "このチェーンは使えません。"],
  not_found: [404, "先にトークンを登録してください。"],
  wrong_kind: [400, "このトークンでは支援者向けの鍵を作れません。"],
  sale_not_purchasable: [400, "このトークンでは支援者向けの鍵を作れません。"],
  unavailable: [503, "チェーンを読み取れなかったため作りませんでした。"],
};

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const disabled = rejectResearchToken();
  if (disabled) return disabled;
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const { projectId } = await context.params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const gate = await ensureResearchSupporterGate(database, projectId, viewer.id);
    return NextResponse.json({ gateId: gate.id }, { headers: NO_STORE });
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: NO_STORE });
    if (cause instanceof ResearchTokenError) {
      const [status, error] = FAILURES[cause.code];
      return NextResponse.json({ error, reason: cause.code }, { status, headers: NO_STORE });
    }
    return NextResponse.json({ error: FAILURES.unavailable[1], reason: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
