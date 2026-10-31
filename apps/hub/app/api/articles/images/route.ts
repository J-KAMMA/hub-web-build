import { claimArticleImage } from "@/lib/server/d1-user-article-drafts";
import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";

export const dynamic = "force-dynamic";

/**
 * 記事に使う画像の確定。先に POST /api/media/images（保留の画像）へ上げ、その id を
 * 下書きまたは自分の公開記事へ結び付ける。結び付けた画像の URL を返す。
 * 本文に書くのも表紙に使うのもこの URL（/api/articles/images/{id}）。
 */
export async function POST(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const body = await readJsonBody(request);
    const image = await claimArticleImage(
      database, profile.id,
      typeof body.targetId === "string" ? body.targetId : "",
      typeof body.imageId === "string" ? body.imageId : "",
    );
    return json({ image }, 201);
  });
}
