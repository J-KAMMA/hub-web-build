import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, getOptionalDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { listResearchProjects } from "@/lib/server/d1-research";
import { readListPagination } from "@/lib/server/list-pagination";
import { requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { createResearchProject } from '@/lib/server/d1-research';
import { clientResearchJson, clientResearchFailure, readClientResearchInput } from '@/lib/server/client-research-route';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url), query = (url.searchParams.get("q") ?? "").trim();
    const { limit, offset } = readListPagination(url, { defaultLimit: 50 });
    if (query.length > 100 || query.split(/\s+/u).length > 8) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
    const database = getHubD1();
    const viewer = await getOptionalDesktopHubProfile(request, database);
    const projects = await listResearchProjects(database, viewer?.id, { query, limit: limit + 1, offset });
    return NextResponse.json({ projects: projects.slice(0, limit), limit, offset, hasMore: projects.length > limit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : error instanceof HubD1UnavailableError ? 503 : 500;
    return NextResponse.json({ error: "research_unavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db);
    return clientResearchJson({ project: await createResearchProject(db, viewer.id, await readClientResearchInput(request, 32768)) }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_research_project') return clientResearchJson({ error: 'タイトル、説明、公開範囲を確認してください。' }, 400);
    return clientResearchFailure(error);
  }
}
