import { NextResponse } from "next/server";

import {
  createCommunityRouteData,
  getCommunitiesRouteData,
} from "@/lib/server/community-route-data";
import { validateOptimizedImageDataUrl } from "@/lib/avatar-image";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getCommunitiesRouteData(request));
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "Community service is unavailable." }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    category?: string;
    imageUrl?: unknown;
    visibility?: string;
  };
  const name = body.name?.trim() ?? "";
  const description = body.description?.trim() ?? "";
  const category = body.category?.trim() ?? "";
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
  if (name.length < 3 || name.length > 100) {
    return NextResponse.json(
      { error: "コミュニティ名は3〜100文字で入力してください。" },
      { status: 400 },
    );
  }
  if (description.length < 10 || description.length > 2000) {
    return NextResponse.json(
      { error: "説明は10〜2000文字で入力してください。" },
      { status: 400 },
    );
  }
  if (!category || category.length > 100) {
    return NextResponse.json(
      { error: "カテゴリを選んでください。" },
      { status: 400 },
    );
  }
  const visibility = ["public", "approval", "private"].includes(body.visibility ?? "")
    ? body.visibility as "public" | "approval" | "private"
    : "public";
  try {
    return NextResponse.json(
      await createCommunityRouteData(request, {
        name,
        description,
        category,
        imageUrl,
        visibility,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json(
        { error: "ログインが必要です。" },
        { status: 401 },
      );
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "Community service is unavailable." }, { status: 503 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "コミュニティを作成できませんでした。",
      },
      { status: 400 },
    );
  }
}
