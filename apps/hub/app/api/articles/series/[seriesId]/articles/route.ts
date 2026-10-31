import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { UserArticleValidationError } from "@/lib/server/d1-user-articles";
import { addArticleToSeries, getOwnSeries, removeArticleFromSeries, reorderSeries } from "@/lib/server/d1-user-article-series";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ seriesId: string }> };

/** 自分の公開記事を末尾へ足す。body: { articleId } */
export async function POST(request: Request, { params }: Context) {
  const { seriesId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const body = await readJsonBody(request);
    if (typeof body.articleId !== "string") throw new UserArticleValidationError("記事の指定が正しくありません。");
    await addArticleToSeries(database, profile.id, seriesId, body.articleId);
    return json({ series: await getOwnSeries(database, profile.id, seriesId) });
  });
}

/** 並びを置き換える。body: { order: string[] }（いま入っている記事の全件） */
export async function PUT(request: Request, { params }: Context) {
  const { seriesId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const body = await readJsonBody(request);
    await reorderSeries(database, profile.id, seriesId, body.order);
    return json({ series: await getOwnSeries(database, profile.id, seriesId) });
  });
}

/** 記事を外す。?articleId= */
export async function DELETE(request: Request, { params }: Context) {
  const { seriesId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const articleId = new URL(request.url).searchParams.get("articleId") ?? "";
    await removeArticleFromSeries(database, profile.id, seriesId, articleId);
    return json({ series: await getOwnSeries(database, profile.id, seriesId) });
  });
}
