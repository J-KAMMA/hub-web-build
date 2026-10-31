import { getOwnArticle, listArticleRevisions } from "@/lib/server/d1-user-article-drafts";
import { handleArticleWrite, json } from "@/lib/server/article-write-route";

export const dynamic = "force-dynamic";

/** 自分の記事（公開中・取り下げ済み）を編集のために読む。本人だけ。履歴も付ける。 */
export async function GET(request: Request, { params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const article = await getOwnArticle(database, profile.id, articleId);
    if (!article) return json({ error: "記事が見つかりません。" }, 404);
    return json({ article, revisions: await listArticleRevisions(database, profile.id, articleId) });
  }, { mutating: false });
}
