import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { createResearchObject, getResearchProject, listResearchObjects } from "@/lib/server/d1-research";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const database = getHubD1();
  const viewer = await getOptionalHubSessionProfile(request, database);
  const project = await getResearchProject(database, (await params).projectId, viewer?.id);
  if (!project) return error("研究プロジェクトが見つかりません。", 404);
  return NextResponse.json({ project, ...await listResearchObjects(database, project.id, viewer?.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  if (!hasSameOrigin(request)) return error("不正なリクエストです。", 403);
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const project = await getResearchProject(database, (await params).projectId, viewer.id);
    if (!project) return error("研究プロジェクトが見つかりません。", 404);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return error("入力内容を確認してください。", 400);
    const objectId = await createResearchObject(database, project, viewer.id, body as Record<string, unknown>);
    return NextResponse.json({ objectId }, { status: 201 });
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) return error("ログインが必要です。", 401);
    if (cause instanceof Error && cause.message === "research_forbidden") return error("編集権限がありません。", 403);
    return error("成果を登録できません。SHA-256ハッシュなどの入力を確認してください。", 400);
  }
}
