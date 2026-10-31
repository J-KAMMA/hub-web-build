import { NextResponse } from "next/server";

import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { moderateReportRouteData } from "@/lib/server/moderation-admin-route-data";

export async function PATCH(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const authError = requireModerationAdmin(request);
  if (authError) return authError;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await request.json().catch(() => null) as { action?: unknown; note?: unknown } | null;
  if (!body || (body.action !== "resolve" && body.action !== "dismiss" && body.action !== "hide")) {
    return NextResponse.json({ error: "処理内容が正しくありません。" }, { status: 400 });
  }
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1000)) {
    return NextResponse.json({ error: "運営メモは1000文字以内で入力してください。" }, { status: 400 });
  }
  const { reportId } = await params;
  try {
    return NextResponse.json(await moderateReportRouteData(reportId, body.action, typeof body.note === "string" ? body.note : ""));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "処理できませんでした。" }, { status: 404 });
  }
}
