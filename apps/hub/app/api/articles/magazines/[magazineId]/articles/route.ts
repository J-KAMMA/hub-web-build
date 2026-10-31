import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { UserArticleValidationError } from "@/lib/server/d1-user-articles";
import {
  addArticleToMagazine,
  getOwnMagazine,
  removeArticleFromMagazine,
  removeOwnArticleFromAnyMagazine,
  reorderMagazine,
} from "@/lib/server/d1-user-article-magazines";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ magazineId: string }> };

/** 記事を末尾へ足す（誰の記事でもよい）。body: { articleId } */
export async function POST(request: Request, { params }: Context) {
  const { magazineId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const body = await readJsonBody(request);
    if (typeof body.articleId !== "string") throw new UserArticleValidationError("記事の指定が正しくありません。");
    await addArticleToMagazine(database, profile.id, magazineId, body.articleId);
    return json({ magazine: await getOwnMagazine(database, profile.id, magazineId) });
  });
}

/** 並びを置き換える。body: { order: string[] }（いま入っている記事の全件） */
export async function PUT(request: Request, { params }: Context) {
  const { magazineId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const body = await readJsonBody(request);
    await reorderMagazine(database, profile.id, magazineId, body.order);
    return json({ magazine: await getOwnMagazine(database, profile.id, magazineId) });
  });
}

/**
 * 記事を外す。?articleId=
 * キュレーター本人は ?articleId= だけで外せる。書き手が自分の記事を他人のマガジンから外すときは &as=author を付ける。
 */
export async function DELETE(request: Request, { params }: Context) {
  const { magazineId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const url = new URL(request.url);
    const articleId = url.searchParams.get("articleId") ?? "";
    if (url.searchParams.get("as") === "author") {
      await removeOwnArticleFromAnyMagazine(database, profile.id, magazineId, articleId);
      return json({ ok: true });
    }
    await removeArticleFromMagazine(database, profile.id, magazineId, articleId);
    return json({ magazine: await getOwnMagazine(database, profile.id, magazineId) });
  });
}
