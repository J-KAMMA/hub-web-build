import { NextResponse } from "next/server";

import { createCommunityForViewer } from "@/lib/server/community-route-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けのコミュニティ作成。検証と作成はWeb側の
 * /api/communities POST と同じ関数を通す。画像はここでは
 * 受けない——画像付き作成はWebの専用フォームへ。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    name?: string;
    description?: string;
    category?: string;
    visibility?: string;
  } | null;
  const name = body?.name?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  const category = body?.category?.trim() ?? "";
  if (name.length < 3 || name.length > 100) {
    return NextResponse.json({ error: "コミュニティ名は3〜100文字で入力してください。" }, { status: 400 });
  }
  if (description.length < 10 || description.length > 2000) {
    return NextResponse.json({ error: "説明は10〜2000文字で入力してください。" }, { status: 400 });
  }
  if (!category || category.length > 100) {
    return NextResponse.json({ error: "カテゴリを選んでください。" }, { status: 400 });
  }
  const visibility = ["public", "approval", "private"].includes(body?.visibility ?? "")
    ? body!.visibility as "public" | "approval" | "private"
    : "public";
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  try {
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json(
      await createCommunityForViewer(database, viewer, { name, description, category, visibility }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "コミュニティを作成できませんでした。" },
      { status: 400 },
    );
  }
}
