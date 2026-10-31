import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { createResearchRelation, getResearchProject } from "@/lib/server/d1-research";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const project = await getResearchProject(database, (await params).projectId, viewer.id);
    if (!project) return NextResponse.json({ error: "研究プロジェクトが見つかりません。" }, { status: 404 });
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    await createResearchRelation(database, project, viewer.id, body as Record<string, unknown>);
    return NextResponse.json({ created: true }, { status: 201 });
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (cause instanceof Error && cause.message === "research_forbidden") return NextResponse.json({ error: "編集権限がありません。" }, { status: 403 });
    return NextResponse.json({ error: "関係を登録できませんでした。" }, { status: 400 });
  }
}
