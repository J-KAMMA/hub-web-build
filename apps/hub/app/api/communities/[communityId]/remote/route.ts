import { readRemoteParticipation, setRemoteParticipation } from "@/lib/server/community-federation-host";
import { json, readBody, withViewer } from "@/lib/server/community-federation-route";

/** 「他のハブからの参加」の状態。オーナーとモデレーターだけが読める。 */
export async function GET(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  return withViewer(request, { write: false }, async (database, viewer) =>
    json(await readRemoteParticipation(database, viewer.id, communityId)));
}

/** 「他のハブからの参加」をオン/オフする。{ enabled: boolean }。オーナーとモデレーターだけ。 */
export async function PUT(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  return withViewer(request, { write: true }, async (database, viewer) => {
    const body = await readBody(request);
    if (typeof body?.enabled !== "boolean") return json({ error: "設定内容が不正です。" }, 400);
    return json(await setRemoteParticipation(database, viewer.id, communityId, body.enabled));
  });
}
