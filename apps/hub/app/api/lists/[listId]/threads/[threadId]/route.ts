import { NextResponse } from "next/server";

import { setD1UserListMembership, UserListInputError } from "@/lib/server/d1-user-lists";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

async function mutate(
  request: Request,
  params: Promise<{ listId: string; threadId: string }>,
  active: boolean,
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getOptionalHubD1();
    if (!database) throw new HubD1UnavailableError();
    const viewer = await requireHubSessionProfile(request, database);
    const { listId, threadId } = await params;
    if (!(await setD1UserListMembership(database, viewer.id, listId, "thread", threadId, active))) {
      return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ active });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "リストを利用できません。" }, { status: 503 });
    if (error instanceof UserListInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "リストを更新できませんでした。" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ listId: string; threadId: string }> }) {
  return mutate(request, params, true);
}
export async function DELETE(request: Request, { params }: { params: Promise<{ listId: string; threadId: string }> }) {
  return mutate(request, params, false);
}
