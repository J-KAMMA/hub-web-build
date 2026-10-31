import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getD1ProfilePageDataForViewer } from "@/lib/server/profile-page-data";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けのプロフィール詳細。組み立ては画面側と同じ
 * profile-page-data に任せる。viewer を外から渡すので、desktop
 * assertionでもCookieセッションでも同じ個人化が効く。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  if (typeof handle !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(handle)) {
    return NextResponse.json({ error: "プロフィールの指定が正しくありません。" }, { status: 400 });
  }
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  try {
    const viewer = await getOptionalHubViewerProfile(request, database);
    const data = await getD1ProfilePageDataForViewer(database, handle, viewer);
    if (!data.profile) {
      return NextResponse.json({ error: "プロフィールが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    throw error;
  }
}
