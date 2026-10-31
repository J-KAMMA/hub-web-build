import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubAuthenticationError,
  getOptionalHubSessionProfile,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import {
  deleteD1VaultReview,
  InvalidVaultReviewError,
  listD1VaultReviews,
  parseVaultReviewInput,
  upsertD1VaultReview,
} from "@/lib/server/d1-vault-reviews";

export async function GET(request: Request) {
  try {
    const contentId = new URL(request.url).searchParams.get("content_id");
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    return NextResponse.json(
      await listD1VaultReviews(database, contentId, viewer?.id ?? null),
    );
  } catch (error) {
    if (error instanceof InvalidVaultReviewError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "レビューを取得できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null);
    const parsed = parseVaultReviewInput(body);
    return NextResponse.json(await upsertD1VaultReview(database, {
      contentId: body && typeof body === "object" ? Reflect.get(body, "content_id") : null,
      profileId: viewer.id,
      ...parsed,
    }), { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "レビューの投稿にはHubへのログインが必要です。" }, { status: 401 });
    }
    if (error instanceof InvalidVaultReviewError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "レビューを保存できませんでした。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null);
    const contentId = body && typeof body === "object" ? Reflect.get(body, "content_id") : null;
    return NextResponse.json(await deleteD1VaultReview(database, contentId, viewer.id));
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "レビューの削除にはHubへのログインが必要です。" }, { status: 401 });
    }
    if (error instanceof InvalidVaultReviewError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "レビューを削除できませんでした。" }, { status: 500 });
  }
}
