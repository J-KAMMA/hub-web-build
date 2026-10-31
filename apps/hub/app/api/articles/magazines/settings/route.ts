import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { getAllowAdding, setAllowAdding } from "@/lib/server/d1-user-article-magazines";
import { UserArticleValidationError } from "@/lib/server/d1-user-articles";

export const dynamic = "force-dynamic";

/** 自分の記事を他の人のマガジンに入れてよいか（既定は許す）。 */
export async function GET(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    return json({ allowAdding: await getAllowAdding(database, profile.id) });
  }, { mutating: false });
}

/** body: { allowAdding: boolean } */
export async function PUT(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const body = await readJsonBody(request);
    if (typeof body.allowAdding !== "boolean") throw new UserArticleValidationError("設定の指定が正しくありません。");
    return json({ allowAdding: await setAllowAdding(database, profile.id, body.allowAdding) });
  });
}
