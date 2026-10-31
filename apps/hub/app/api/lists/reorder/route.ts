import { NextResponse } from "next/server";

import { reorderD1UserList, listD1UserLists } from "@/lib/server/d1-user-lists";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      listId?: unknown;
      list_id?: unknown;
      direction?: unknown;
    };
    const listId = typeof body.listId === "string"
      ? body.listId
      : typeof body.list_id === "string"
        ? body.list_id
        : "";
    if (!listId || (body.direction !== "up" && body.direction !== "down")) {
      return NextResponse.json({ error: "リストと移動方向を指定してください。" }, { status: 400 });
    }
    const database = getOptionalHubD1();
    if (!database) throw new HubD1UnavailableError();
    const viewer = await requireHubSessionProfile(request, database);
    if (!(await reorderD1UserList(database, viewer.id, listId, body.direction))) {
      return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ lists: await listD1UserLists(database, viewer.id) });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "リストを利用できません。" }, { status: 503 });
    return NextResponse.json({ error: "リストを並び替えできませんでした。" }, { status: 500 });
  }
}
