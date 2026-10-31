import { CommunityFederationError, decideHeldObject, listHeldObjects } from "@/lib/server/community-federation-host";
import { json, readBody, withViewer } from "@/lib/server/community-federation-route";

/** 自動保留された外部メンバーの書き込み（リンクが多いなど）。モデレーター以上が見る。 */
export async function GET(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  return withViewer(request, { write: false }, async (database, viewer) =>
    json({ held: await listHeldObjects(database, viewer.id, communityId) }));
}

/** 保留中の書き込みを公開する（release）か、捨てる（discard）。{ objectUrl, decision }。 */
export async function POST(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  return withViewer(request, { write: true }, async (database, viewer) => {
    const body = await readBody(request);
    if (typeof body?.objectUrl !== "string" || body.objectUrl.length > 2048 || (body.decision !== "release" && body.decision !== "discard")) {
      throw new CommunityFederationError("操作内容が不正です。", 400);
    }
    return json(await decideHeldObject(database, viewer.id, communityId, body.objectUrl, body.decision));
  });
}
