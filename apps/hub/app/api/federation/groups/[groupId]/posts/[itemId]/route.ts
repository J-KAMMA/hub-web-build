import { deleteOwnRemoteCommunityPost } from "@/lib/server/community-federation-member";
import { json, withViewer } from "@/lib/server/community-federation-route";

/** 自分が他のハブのコミュニティへ書いた発言を取り下げる。 */
export async function DELETE(request: Request, { params }: { params: Promise<{ groupId: string; itemId: string }> }) {
  const { itemId } = await params;
  return withViewer(request, { write: true }, async (database, viewer) => {
    const result = await deleteOwnRemoteCommunityPost(database, viewer, itemId);
    return result.ok ? json({ deleted: true }) : json({ error: result.message, code: result.error }, result.status);
  });
}
