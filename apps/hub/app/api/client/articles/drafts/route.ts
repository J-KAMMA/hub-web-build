import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { listDrafts } from "@/lib/server/d1-user-article-drafts";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubSuspendedError } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/** 自分の下書き一覧。本文は載せず、一覧に要る項目だけ返す。本人の下書きだけ。 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const drafts = (await listDrafts(database, viewer.id)).map((draft) => ({
      id: draft.id, title: draft.title, summary: draft.summary, status: draft.status,
      publishAt: draft.publishAt, updatedAt: draft.updatedAt,
    }));
    return Response.json({ drafts }, { headers });
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : 503;
    return Response.json({ error: status === 401 ? "desktop_authentication_failed" : status === 403 ? "suspended" : "unavailable" }, { status, headers });
  }
}
