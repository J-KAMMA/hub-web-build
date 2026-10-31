import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { createMagazine, listOwnMagazines, parseMagazineInput } from "@/lib/server/d1-user-article-magazines";

export const dynamic = "force-dynamic";

/** 自分のマガジン一覧。?articleId= を付けると、その記事が各マガジンに入っているかも返す。 */
export async function GET(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const articleId = new URL(request.url).searchParams.get("articleId") ?? undefined;
    return json({ magazines: await listOwnMagazines(database, profile.id, articleId) });
  }, { mutating: false });
}

/** マガジンを作る。 */
export async function POST(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const magazine = await createMagazine(database, profile.id, parseMagazineInput(await readJsonBody(request)));
    return json({ magazine }, 201);
  });
}
