import { NextResponse } from "next/server";

import { deleteD1UserList, updateD1UserList, UserListInputError } from "@/lib/server/d1-user-lists";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

function errorResponse(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "リストを利用できません。しばらくしてから再度お試しください。" }, { status: 503 });
  }
  if (error instanceof UserListInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "リストを操作できませんでした。" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getOptionalHubD1();
    if (!database) throw new HubD1UnavailableError("List database is unavailable.");
    const viewer = await requireHubSessionProfile(request, database);
    const { listId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (!(await updateD1UserList(database, viewer.id, listId, body))) {
      return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getOptionalHubD1();
    if (!database) throw new HubD1UnavailableError("List database is unavailable.");
    const viewer = await requireHubSessionProfile(request, database);
    const { listId } = await params;
    if (!(await deleteD1UserList(database, viewer.id, listId))) {
      return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
