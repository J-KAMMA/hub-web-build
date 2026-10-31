import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  createD1UserList,
  listD1UserLists,
  UserListInputError,
} from "@/lib/server/d1-user-lists";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

function listError(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json(
      { error: "リストを利用できません。しばらくしてから再度お試しください。" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  if (error instanceof UserListInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "リストを操作できませんでした。" }, { status: 500, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    return NextResponse.json(
      { lists: await listD1UserLists(database, viewer.id) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return listError(error);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(
      { list: await createD1UserList(database, viewer.id, body) },
      { status: 201 },
    );
  } catch (error) {
    return listError(error);
  }
}
