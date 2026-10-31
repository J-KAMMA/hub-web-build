import { NextResponse } from "next/server";

import { rejectResearchToken } from "@/lib/server/research-token-flag";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  deleteResearchProjectToken,
  getResearchProjectToken,
  putResearchProjectToken,
  ResearchTokenError,
  researchTokenDeps,
  type ResearchTokenFailure,
} from "@/lib/server/research-project-token";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };
const FAILURES: Record<ResearchTokenFailure, [number, string]> = {
  research_not_found: [404, "研究プロジェクトが見つかりません。"],
  research_forbidden: [403, "オーナーだけが登録できます。"],
  invalid_input: [400, "入力内容を確かめてください。"],
  unsupported_chain: [400, "このチェーンは使えません。"],
  not_found: [404, "トークンが見つかりませんでした。"],
  wrong_kind: [400, "選んだ種類のトークンではないようです。"],
  sale_not_purchasable: [400, "この販売はハブでは使えません。"],
  unavailable: [503, "チェーンを読み取れなかったため登録しませんでした。"],
};

function failure(cause: unknown): NextResponse {
  if (cause instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: HEADERS });
  if (cause instanceof ResearchTokenError) {
    const [status, error] = FAILURES[cause.code];
    return NextResponse.json({ error, reason: cause.code }, { status, headers: HEADERS });
  }
  return NextResponse.json({ error: FAILURES.unavailable[1], reason: "unavailable" }, { status: 503, headers: HEADERS });
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const disabled = rejectResearchToken();
  if (disabled) return disabled;
  try {
    const { projectId } = await context.params;
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    return NextResponse.json({ token: await getResearchProjectToken(database, projectId, viewer?.id) }, { headers: HEADERS });
  } catch (cause) {
    return failure(cause);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const disabled = rejectResearchToken();
  if (disabled) return disabled;
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: HEADERS });
  try {
    const { projectId } = await context.params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null);
    return NextResponse.json({ token: await putResearchProjectToken(database, projectId, viewer.id, body, researchTokenDeps()) }, { headers: HEADERS });
  } catch (cause) {
    return failure(cause);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const disabled = rejectResearchToken();
  if (disabled) return disabled;
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: HEADERS });
  try {
    const { projectId } = await context.params;
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    await deleteResearchProjectToken(database, projectId, viewer.id);
    return NextResponse.json({ ok: true }, { headers: HEADERS });
  } catch (cause) {
    return failure(cause);
  }
}
