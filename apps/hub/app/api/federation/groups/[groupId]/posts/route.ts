import { postToRemoteCommunity } from "@/lib/server/community-federation-member";
import { json, readBody, withViewer } from "@/lib/server/community-federation-route";

/**
 * 他のハブのコミュニティへ書く。{ body, title?, replyToItemId?, channelId? }。
 * 持ち主のハブが確認して Announce するまで、画面には出ない（承認待ち・保留・断られることがある）。
 */
export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return withViewer(request, { write: true }, async (database, viewer) => {
    const input = await readBody(request);
    const text = typeof input?.body === "string" ? input.body.trim() : "";
    const title = typeof input?.title === "string" ? input.title.trim() : "";
    if ((!text && !title) || text.length > 1900 || title.length > 100 ||
        (input?.replyToItemId != null && typeof input.replyToItemId !== "string") ||
        (input?.channelId != null && typeof input.channelId !== "string")) {
      return json({ error: "投稿内容を確認してください（本文1900字・題名100字まで）。" }, 400);
    }
    const result = await postToRemoteCommunity(database, viewer, groupId, {
      body: text,
      title: title || undefined,
      replyToItemId: (input?.replyToItemId as string | null | undefined) ?? null,
      channelId: (input?.channelId as string | null | undefined) ?? null,
    });
    return result.ok
      ? json({ submitted: true, message: "送りました。持ち主のハブが確認すると表示されます。" }, 202)
      : json({ error: result.message, code: result.error }, result.status);
  });
}
