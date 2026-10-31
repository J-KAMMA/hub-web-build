import { NextResponse } from "next/server";

import { rejectResearchToken } from "@/lib/server/research-token-flag";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { deleteResearchFundReport, ResearchFundReportError, type ResearchFundReportFailure } from "@/lib/server/research-fund-reports";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };
const FAILURES: Record<ResearchFundReportFailure, [number, string]> = {
  research_not_found: [404, "研究プロジェクトが見つかりません。"],
  research_forbidden: [403, "オーナーだけが消せます。"],
  invalid_input: [400, "入力内容を確かめてください。"],
  report_not_found: [404, "報告が見つかりません。"],
};

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string; reportId: string }> }) {
  const disabled = rejectResearchToken();
  if (disabled) return disabled;
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: HEADERS });
  try {
    const { projectId, reportId } = await context.params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    await deleteResearchFundReport(database, projectId, viewer.id, reportId);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: HEADERS });
    if (cause instanceof ResearchFundReportError) {
      const [status, error] = FAILURES[cause.code];
      return NextResponse.json({ error, reason: cause.code }, { status, headers: HEADERS });
    }
    return NextResponse.json({ error: "消せませんでした。", reason: "unavailable" }, { status: 503, headers: HEADERS });
  }
}
