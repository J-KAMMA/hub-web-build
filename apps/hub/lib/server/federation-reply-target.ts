import "server-only";

import { getHubD1 } from "@/lib/server/hub-d1";

/**
 * 返信先が外部から取り込んだ投稿なら、その元の URL を返す。
 * Federation の /v1/posts は自 Hub の投稿 ID を自分の object URL に直すので、外部の投稿は URL で渡す必要がある。
 * Hub の D1 を読むのは Hub 自身のこのモジュールで、Federation の窓口（federation-gateway）は D1 を持たない。
 */
export async function remoteReplyTarget(postId: string | null | undefined): Promise<string | null> {
  if (!postId) return null;
  try {
    const row = await getHubD1().prepare(
      "SELECT origin_object_id FROM social_posts WHERE id = ? AND origin = 'remote' LIMIT 1",
    ).bind(postId).first<{ origin_object_id: string | null }>();
    return row?.origin_object_id ?? null;
  } catch {
    return null;
  }
}
