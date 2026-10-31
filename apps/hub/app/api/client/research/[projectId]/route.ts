import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, getOptionalDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getResearchProject, listResearchObjects } from "@/lib/server/d1-research";
import { readResearchWorkspace } from '@/lib/server/research-workspace';
import { requireDesktopHubProfile } from '@/lib/server/desktop-hub-auth';
import { updateResearchProject } from '@/lib/server/d1-research';
import { clientResearchJson, clientResearchFailure, readClientResearchInput } from '@/lib/server/client-research-route';

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const database = getHubD1();
    const viewer = await getOptionalDesktopHubProfile(request, database);
    const project = await getResearchProject(database, (await params).projectId, viewer?.id);
    if (!project) return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const workspace = await readResearchWorkspace(database, project.id, viewer?.id);
    return NextResponse.json({ project, ...await listResearchObjects(database, project.id, viewer?.id), canEdit: project.ownerProfileId === viewer?.id, signedIn: Boolean(viewer), workspace }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : error instanceof HubD1UnavailableError ? 503 : 500;
    return NextResponse.json({ error: "research_unavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const db = getHubD1(), viewer = await requireDesktopHubProfile(request, db);
    return clientResearchJson({project:await updateResearchProject(db,(await params).projectId,viewer.id,await readClientResearchInput(request,32768))});
  } catch(error) {
    const code=error instanceof Error ? error.message : '';
    if(['research_not_found','research_forbidden','invalid_research_project'].includes(code)) return clientResearchJson({error:code},code==='research_not_found'?404:code==='research_forbidden'?403:400);
    return clientResearchFailure(error);
  }
}
