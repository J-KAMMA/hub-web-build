import { joinRemoteCommunity, listRemoteCommunities } from "@/lib/server/community-federation-member";
import { json, readBody, withViewer } from "@/lib/server/community-federation-route";
import { pullFederationGroupEventsIfStale } from "@/lib/server/federation-group-inbound";
import { consumeD1PostQuota } from "@/lib/server/d1-rate-limit";

/** 参加している他のハブのコミュニティの一覧。 */
export async function GET(request: Request) {
  return withViewer(request, { write: false }, async (database, viewer) => {
    await pullFederationGroupEventsIfStale(database);
    return json({ communities: await listRemoteCommunities(database, viewer.id) });
  });
}

/**
 * 他のハブのコミュニティに参加を申し込む。{ handle: "名前@ホスト" }。
 * 持ち主のハブが受け入れる（Accept）まで state は pending で、書き込めない。
 */
export async function POST(request: Request) {
  return withViewer(request, { write: true }, async (database, viewer) => {
    const body = await readBody(request);
    if (typeof body?.handle !== "string" || body.handle.trim().length < 3 || body.handle.length > 320) {
      return json({ error: "コミュニティは「名前@ホスト」の形で入力してください。", code: "invalid_handle" }, 400);
    }
    await consumeD1PostQuota(database, viewer, "social_follow");
    const result = await joinRemoteCommunity(database, viewer.id, { handle: body.handle.trim().replace(/^[!@]/, "") });
    if (!result.ok) return json({ error: result.message, code: result.error }, result.status);
    return json({ remoteCommunityId: result.remoteCommunityId, state: result.state, name: result.name, host: result.host });
  });
}
