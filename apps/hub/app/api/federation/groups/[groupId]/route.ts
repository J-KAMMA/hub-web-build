import { leaveRemoteCommunity, readRemoteCommunity } from "@/lib/server/community-federation-member";
import { json, withViewer } from "@/lib/server/community-federation-route";
import { pullFederationGroupEventsIfStale } from "@/lib/server/federation-group-inbound";

/** 参加している他のハブのコミュニティの中身。持ち主のハブが Announce した発言だけが載る。 */
export async function GET(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return withViewer(request, { write: false }, async (database, viewer) => {
    await pullFederationGroupEventsIfStale(database);
    const view = await readRemoteCommunity(database, viewer, groupId);
    return view ? json(view) : json({ error: "コミュニティが見つかりません。" }, 404);
  });
}

/** 退出する。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return withViewer(request, { write: true }, async (database, viewer) => {
    const result = await leaveRemoteCommunity(database, viewer.id, groupId);
    return result.ok ? json({ left: true }) : json({ error: result.message, code: result.error }, result.status);
  });
}
