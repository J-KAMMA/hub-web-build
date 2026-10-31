import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { createResearchProject, listResearchProjects } from "@/lib/server/d1-research";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { hubCatalogResearchQuery } from "@/lib/hub-network-client";

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let query: string, limit = 30, offset = 0;
  const paged = params.has("limit") || params.has("offset");
  try {
    if ([...params.keys()].some(key => !["q", "limit", "offset"].includes(key) || params.getAll(key).length !== 1)) throw Error();
    query = hubCatalogResearchQuery(params.get("q") ?? "");
    for (const key of ["limit", "offset"] as const) {
      const value = params.get(key);
      if (value === null) continue;
      const count = Number(value);
      if (!/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(value) || !Number.isSafeInteger(count) || (key === "limit" ? count < 1 || count > 100 : count < 0)) throw Error();
      if (key === "limit") limit = count; else offset = count;
    }
  } catch { return NextResponse.json({ error: "invalid_query" }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const database = getHubD1();
  const viewer = await getOptionalHubSessionProfile(request, database);
  const projects = await listResearchProjects(database, viewer?.id, paged ? { query, limit: limit + 1, offset } : { query });
  return NextResponse.json(paged ? { projects: projects.slice(0, limit), limit, offset, hasMore: projects.length > limit } : { projects }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("不正なリクエストです。", 403);
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return error("入力内容を確認してください。", 400);
    const project = await createResearchProject(database, viewer.id, body as Record<string, unknown>);
    return NextResponse.json({ project }, { status: 201 });
  } catch (cause) {
    if (cause instanceof HubAuthenticationError) return error("ログインが必要です。", 401);
    if (cause instanceof Error && cause.message === "invalid_research_project") return error("タイトル、説明、公開範囲を確認してください。", 400);
    return error("研究プロジェクトを作成できませんでした。", 500);
  }
}
