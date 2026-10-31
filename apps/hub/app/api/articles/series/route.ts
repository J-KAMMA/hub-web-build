import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { createSeries, listAddableArticles, listOwnSeries, parseSeriesInput } from "@/lib/server/d1-user-article-series";

export const dynamic = "force-dynamic";

/** 自分のシリーズ一覧と、まだどこにも入っていない自分の公開記事（追加の候補）。 */
export async function GET(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const [series, addable] = await Promise.all([listOwnSeries(database, profile.id), listAddableArticles(database, profile.id)]);
    return json({ series, addable });
  }, { mutating: false });
}

/** シリーズを作る（著者本人）。 */
export async function POST(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const series = await createSeries(database, profile.id, parseSeriesInput(await readJsonBody(request)));
    return json({ series }, 201);
  });
}
