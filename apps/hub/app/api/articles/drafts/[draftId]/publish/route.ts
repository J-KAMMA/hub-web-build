import { hasAdultOptIn } from "@/lib/adult/opt-in";
import { UserArticleNotFoundError, getDraft, publishDraft, scheduleDraft, unscheduleDraft } from "@/lib/server/d1-user-article-drafts";
import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ draftId: string }> };

const ADULT_NEEDS_OPT_IN = "成人向けとして公開するには、先に成人向け表示を有効にしてください。";

/**
 * 公開する。本文に `publishAt`（ISO）があれば予約、無ければ今すぐ。
 * 下書きの id が記事の id になり、再送しても記事は1本。
 */
export async function POST(request: Request, { params }: Context) {
  const { draftId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const body = await readJsonBody(request);
    const draft = await getDraft(database, profile.id, draftId);
    if (draft?.audience === "adult" && !(await hasAdultOptIn())) return json({ error: ADULT_NEEDS_OPT_IN }, 409);
    if (body.publishAt !== undefined && body.publishAt !== null) {
      if (!draft) throw new UserArticleNotFoundError();
      const scheduled = await scheduleDraft(database, profile.id, draftId, body.publishAt as string);
      return json({ scheduled: true, publishAt: scheduled.publishAt, draft: scheduled });
    }
    const published = await publishDraft(database, profile, draftId);
    const href = published.audience === "adult" ? `/adult/articles/${published.id}` : `/articles/${published.id}`;
    return json({ id: published.id, href, duplicate: published.duplicate }, published.duplicate ? 200 : 201);
  });
}

/** 予約を取り消して下書きへ戻す。 */
export async function DELETE(request: Request, { params }: Context) {
  const { draftId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    const draft = await unscheduleDraft(database, profile.id, draftId);
    return json({ draft });
  });
}
