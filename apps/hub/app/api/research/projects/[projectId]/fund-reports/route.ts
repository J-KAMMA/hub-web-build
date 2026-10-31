import { NextResponse } from "next/server";

import { rejectResearchToken } from "@/lib/server/research-token-flag";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  createResearchFundReport,
  listResearchFundReports,
  ResearchFundReportError,
  type ResearchFundReportFailure,
} from "@/lib/server/research-fund-reports";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };
const FAILURES: Record<ResearchFundReportFailure, [number, string]> = {
  research_not_found: [404, "研究プロジェクトが見つかりません。"],
  research_forbidden: [403, "オーナーだけが書けます。"],
  invalid_input: [400, "入力内容を確かめてください。"],
  report_not_found: [404, "報告が見つかりません。"],
};

function fundReportFailure(cause: unknown): NextResponse {
  if (cause instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: HEADERS });
  if (cause instanceof ResearchFundReportError) {
    const [status, error] = FAILURES[cause.code];
    return NextResponse.json({ error, reason: cause.code }, { status, headers: HEADERS });
  }
  return NextResponse.json({ error: "保存できませんでした。", reason: "unavailable" }, { status: 503, headers: HEADERS });
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const disabled = rejectResearchToken();
  if (disabled) return disabled;
  try {
    const { projectId } = await context.params;
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    return NextResponse.json({ reports: await listResearchFundReports(database, projectId, viewer?.id) }, { headers: HEADERS });
  } catch (cause) {
    return fundReportFailure(cause);
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const disabled = rejectResearchToken();
  if (disabled) return disabled;
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: HEADERS });
  try {
    const { projectId } = await context.params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null);
    return NextResponse.json({ report: await createResearchFundReport(database, projectId, viewer.id, body) }, { status: 201, headers: HEADERS });
  } catch (cause) {
    return fundReportFailure(cause);
  }
}
