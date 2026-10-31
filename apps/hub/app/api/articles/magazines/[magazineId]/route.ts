import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { UserArticleNotFoundError } from "@/lib/server/d1-user-article-drafts";
import { deleteMagazine, getOwnMagazine, parseMagazineInput, updateMagazine } from "@/lib/server/d1-user-article-magazines";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ magazineId: string }> };

/** 自分のマガジンの中身（取り下げ中の記事も含む）。他人のマガジンは404。 */
export async function GET(request: Request, { params }: Context) {
  const { magazineId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const magazine = await getOwnMagazine(database, profile.id, magazineId);
    if (!magazine) throw new UserArticleNotFoundError();
    return json({ magazine });
  }, { mutating: false });
}

/** 題と説明を直す。 */
export async function PATCH(request: Request, { params }: Context) {
  const { magazineId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    await updateMagazine(database, profile.id, magazineId, parseMagazineInput(await readJsonBody(request)));
    return json({ magazine: await getOwnMagazine(database, profile.id, magazineId) });
  });
}

/** マガジンを消す。記事は消えず、集めだけが解ける。 */
export async function DELETE(request: Request, { params }: Context) {
  const { magazineId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    if (!(await deleteMagazine(database, profile.id, magazineId))) throw new UserArticleNotFoundError();
    return json({ ok: true });
  });
}
