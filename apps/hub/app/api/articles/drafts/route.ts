import { createDraft, listDrafts, listOwnArticles, parseDraftInput } from "@/lib/server/d1-user-article-drafts";
import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";

export const dynamic = "force-dynamic";

/** 自分の下書きと、自分が公開した記事（公開中・取り下げ済み）の一覧。本人だけ。 */
export async function GET(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const [drafts, articles] = await Promise.all([listDrafts(database, profile.id), listOwnArticles(database, profile.id)]);
    return json({ drafts, articles });
  }, { mutating: false });
}

/** 下書きを新しく作る。題・本文は空でよい。 */
export async function POST(request: Request) {
  return handleArticleWrite(request, async ({ database, profile }) => {
    const draft = await createDraft(database, profile.id, parseDraftInput(await readJsonBody(request)));
    return json({ draft }, 201);
  });
}
