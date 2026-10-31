import { deleteDraft, getDraft, parseDraftInput, saveDraft } from "@/lib/server/d1-user-article-drafts";
import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ draftId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { draftId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const draft = await getDraft(database, profile.id, draftId);
    return draft ? json({ draft }) : json({ error: "下書きが見つかりません。" }, 404);
  }, { mutating: false });
}

/** 自動保存。全項目を置き換える。他人の下書きは見つからない扱い（404）。 */
export async function PUT(request: Request, { params }: Context) {
  const { draftId } = await params;
  return handleArticleWrite(request, async ({ database, profile, origin }) => {
    const draft = await saveDraft(database, profile.id, draftId, parseDraftInput(await readJsonBody(request)), { origin });
    return json({ draft });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { draftId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const removed = await deleteDraft(database, profile.id, draftId);
    return removed ? json({ ok: true }) : json({ error: "下書きが見つかりません。" }, 404);
  });
}
