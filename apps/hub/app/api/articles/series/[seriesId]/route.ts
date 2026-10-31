import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { UserArticleNotFoundError } from "@/lib/server/d1-user-article-drafts";
import { deleteSeries, getOwnSeries, parseSeriesInput, updateSeries } from "@/lib/server/d1-user-article-series";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ seriesId: string }> };

/** 自分のシリーズの中身（取り下げ中の記事も含む）。他人のシリーズは404。 */
export async function GET(request: Request, { params }: Context) {
  const { seriesId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const series = await getOwnSeries(database, profile.id, seriesId);
    if (!series) throw new UserArticleNotFoundError();
    return json({ series });
  }, { mutating: false });
}

/** 題と説明を直す（著者本人）。 */
export async function PATCH(request: Request, { params }: Context) {
  const { seriesId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    await updateSeries(database, profile.id, seriesId, parseSeriesInput(await readJsonBody(request)));
    return json({ series: await getOwnSeries(database, profile.id, seriesId) });
  });
}

/** シリーズを消す（著者本人）。記事は消えず、束ねだけが解ける。 */
export async function DELETE(request: Request, { params }: Context) {
  const { seriesId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    if (!(await deleteSeries(database, profile.id, seriesId))) throw new UserArticleNotFoundError();
    return json({ ok: true });
  });
}
