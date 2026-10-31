import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, getOptionalDesktopHubProfile, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getThreadKnowledgePlatform, updateThreadKnowledgePlatform, ThreadKnowledgeAccessError, readThreadSummaryBefore } from "@/lib/server/thread-knowledge-platform";

type Context = { params: Promise<{ threadId: string }> };
const headers = { "cache-control": "private, no-store" };
function failure(error: unknown) {
  const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403
    : error instanceof HubD1UnavailableError ? 503 : error instanceof ThreadKnowledgeAccessError ? error.status : 400;
  return NextResponse.json({ error: status === 401 ? "Hubへ接続が必要です。" : error instanceof Error ? error.message : "共同まとめを更新できませんでした。" }, { status, headers });
}
export async function GET(request: Request, { params }: Context) {
  try {
    const { threadId } = await params;
    const db = getHubD1();
    const viewer = await getOptionalDesktopHubProfile(request, db);
    return NextResponse.json(await getThreadKnowledgePlatform(db, threadId, viewer, readThreadSummaryBefore(new URL(request.url).searchParams)), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { threadId } = await params;
    const db = getHubD1();
    const viewer = await requireDesktopHubProfile(request, db);
    return NextResponse.json(await updateThreadKnowledgePlatform(db, viewer, threadId, await request.json()), { headers });
  } catch (error) { return failure(error); }
}
