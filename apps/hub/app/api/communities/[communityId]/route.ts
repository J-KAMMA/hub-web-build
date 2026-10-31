import { NextResponse } from "next/server";

import { validateOptimizedImageDataUrl } from "@/lib/avatar-image";
import { updateCommunityRouteData } from "@/lib/server/community-route-data";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ communityId: string }> },
) {
  const originDenied = requireSameOrigin(request);
  if (originDenied) return originDenied;
  const { communityId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    category?: unknown;
    visibility?: unknown;
    knowledgeLabel?: unknown;
    knowledgeDescription?: unknown;
    imageUrl?: unknown;
    operationId?: unknown;
    note?: unknown;
  };
  if (
    typeof body.operationId !== "string" ||
    !/^[A-Za-z0-9-]{16,80}$/.test(body.operationId)
  )
    return NextResponse.json(
      { error: "操作IDが正しくありません。" },
      { status: 400 },
    );
  const normalize = (value: unknown) =>
    typeof value === "string" ? value.normalize("NFKC").trim() : undefined;
  const name = normalize(body.name);
  const description = normalize(body.description);
  const category = normalize(body.category);
  const visibility =
    typeof body.visibility === "string" &&
    ["public", "approval", "private"].includes(body.visibility)
      ? (body.visibility as "public" | "approval" | "private")
      : undefined;
  const knowledgeLabel = normalize(body.knowledgeLabel);
  const knowledgeDescription = normalize(body.knowledgeDescription);
  const note = normalize(body.note)?.slice(0, 500);
  if (body.name !== undefined && (!name || name.length < 3 || name.length > 100))
    return NextResponse.json(
      { error: "コミュニティ名は3〜100文字で入力してください。" },
      { status: 400 },
    );
  if (
    body.description !== undefined &&
    (!description || description.length < 10 || description.length > 2000)
  )
    return NextResponse.json(
      { error: "説明は10〜2000文字で入力してください。" },
      { status: 400 },
    );
  if (body.category !== undefined && (!category || category.length > 100))
    return NextResponse.json(
      { error: "カテゴリを選んでください。" },
      { status: 400 },
    );
  if (
    body.visibility !== undefined &&
    visibility === undefined
  )
    return NextResponse.json(
      { error: "公開範囲が正しくありません。" },
      { status: 400 },
    );
  if (
    body.knowledgeLabel !== undefined &&
    (!knowledgeLabel || knowledgeLabel.length > 40)
  )
    return NextResponse.json(
      { error: "共同ページの表示名は1〜40文字で入力してください。" },
      { status: 400 },
    );
  if (
    body.knowledgeDescription !== undefined &&
    (!knowledgeDescription || knowledgeDescription.length > 160)
  )
    return NextResponse.json(
      { error: "共同ページの説明は1〜160文字で入力してください。" },
      { status: 400 },
    );
  let imageUrl: string | undefined;
  if (body.imageUrl !== undefined) {
    try {
      imageUrl = validateOptimizedImageDataUrl(body.imageUrl);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "画像を確認できませんでした。",
        },
        { status: 400 },
      );
    }
  }
  if (
    name === undefined &&
    description === undefined &&
    category === undefined &&
    visibility === undefined &&
    knowledgeLabel === undefined &&
    knowledgeDescription === undefined &&
    imageUrl === undefined
  )
    return NextResponse.json(
      { error: "変更内容がありません。" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await updateCommunityRouteData(request, {
        communityId,
        name,
        description,
        category,
        visibility,
        knowledgeLabel,
        knowledgeDescription,
        imageUrl,
        operationId: body.operationId,
        note,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "コミュニティを更新できませんでした。";
    const status = message.includes("オーナー")
      ? 403
      : message.includes("見つかりません")
        ? 404
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
