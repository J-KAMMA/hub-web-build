import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { findUserArticle } from "@/lib/server/d1-user-articles";
import { attachAccessGate, detachAccessGate } from "@/lib/server/access-gates";
import { hasAdultOptIn } from "@/lib/adult/opt-in";
import { getOwnArticle, isArticleIdentifier, updateUserArticle, withdrawUserArticle } from "@/lib/server/d1-user-article-drafts";
import { handleArticleWrite, json, readJsonBody } from "@/lib/server/article-write-route";
import { setCommentsEnabled } from "@/lib/server/d1-user-article-engagement";
import { getContentLicense, parseContentLicenseInput, setContentLicense } from "@/lib/server/content-licenses";
import { unpublishAttachedFiles } from "@/lib/server/content-files";

export const dynamic = "force-dynamic";

/**
 * 公開記事の本文。成人向けは成人区分を指定した経路だけが返す決まりなので、
 * ここは一般区分に固定する。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { articleId } = await params;
  if (typeof articleId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(articleId)) {
    return NextResponse.json({ error: "記事の指定が正しくありません。" }, { status: 400 });
  }
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
  const article = await findUserArticle(database, articleId, { audience: "general", viewerProfileId: viewer?.id ?? null });
  if (!article) {
    return NextResponse.json({ error: "記事が見つかりません。" }, { status: 404 });
  }
  const license = await getContentLicense(database, { targetType: "article", targetId: articleId }).catch(() => "arr" as const);
  return NextResponse.json(
    { article: { ...article, license } },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * 公開中の記事を直す（著者本人だけ）。直前の内容が履歴に残る。
 * accessGateId を含めると閲覧条件の付け替え（null で外す）も同じ操作で行う。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { articleId } = await params;
  return handleArticleWrite(request, async ({ database, profile, origin }) => {
    if (!isArticleIdentifier(articleId)) return json({ error: "記事の指定が正しくありません。" }, 400);
    const body = await readJsonBody(request);
    if (body.audience === "adult" && !(await hasAdultOptIn())) {
      return json({ error: "成人向けとして公開するには、先に成人向け表示を有効にしてください。" }, 409);
    }
    const article = await updateUserArticle(database, profile.id, articleId, body, { origin });
    /* ライセンス。厳しい側（全権利留保）へ戻すのは門の付け替えより先、CC へ開くのは後。 */
    const licenseChange = Object.hasOwn(body, "license") ? parseContentLicenseInput(body.license) : null;
    const target = { targetType: "article", targetId: articleId };
    if (licenseChange === "arr") await setContentLicense(database, profile.id, target, licenseChange);
    if (Object.hasOwn(body, "accessGateId")) {
      if (typeof body.accessGateId === "string" && body.accessGateId) {
        await attachAccessGate(database, profile.id, { targetType: "article", targetId: articleId }, body.accessGateId);
      } else {
        await detachAccessGate(database, profile.id, { targetType: "article", targetId: articleId });
      }
    }
    if (licenseChange && licenseChange !== "arr") await setContentLicense(database, profile.id, target, licenseChange);
    if (typeof body.commentsEnabled === "boolean") await setCommentsEnabled(database, profile.id, articleId, body.commentsEnabled);
    return json({ article: (await getOwnArticle(database, profile.id, articleId)) ?? article });
  });
}

/** 取り下げる（著者本人だけ）。記事は消さず、公開をやめる。履歴は残る。 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
) {
  const { articleId } = await params;
  return handleArticleWrite(request, async ({ database, profile }) => {
    if (!isArticleIdentifier(articleId)) return json({ error: "記事の指定が正しくありません。" }, 400);
    const changed = await withdrawUserArticle(database, profile.id, articleId);
    await unpublishAttachedFiles(database, { targetType: "article", targetId: articleId });
    return json({ ok: true, withdrawn: changed });
  });
}
