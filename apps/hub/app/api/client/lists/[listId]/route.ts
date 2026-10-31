import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import {
  deleteD1UserList,
  listD1UserLists,
  setD1UserListMembership,
  updateD1UserList,
  UserListInputError,
} from "@/lib/server/d1-user-lists";
import { getD1Thread } from "@/lib/server/d1-threads";
import { HubSuspendedError } from "@/lib/server/hub-session";

type ProfileRow = { id: string; handle: string; display_name: string; avatar_url: string | null };

/**
 * 自分のリストの中身。list_profiles/list_threads のIDを、表示に
 * 必要な最小の形（プロフィール・スレッド見出し）に解決して返す。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  if (typeof listId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(listId)) {
    return NextResponse.json({ error: "リストの指定が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const list = (await listD1UserLists(database, viewer.id)).find((item) => item.id === listId);
    if (!list) {
      return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
    }
    const profileIds = list.profileIds.slice(0, 100);
    const [profiles, threads] = await Promise.all([
      profileIds.length
        ? database.prepare(
          `SELECT id, handle, display_name, avatar_url FROM profiles
            WHERE id IN (${profileIds.map(() => "?").join(",")})
              AND NOT EXISTS (
                SELECT 1 FROM profile_moderation_status m
                WHERE m.profile_id = profiles.id AND m.status = 'suspended'
              )`,
        ).bind(...profileIds).all<ProfileRow>()
        : Promise.resolve({ results: [] as ProfileRow[] }),
      Promise.all(
        list.threadIds.slice(0, 100).map(async (threadId) => {
          const thread = await getD1Thread(database, threadId).catch(() => null);
          return thread ? { id: thread.id, title: thread.title, boardKey: thread.boardKey, postCount: thread.postCount, updatedAt: thread.updatedAt } : null;
        }),
      ),
    ]);
    return NextResponse.json(
      {
        list,
        profiles: profiles.results.map((row) => ({
          id: row.id, handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_url ?? undefined,
        })),
        threads: threads.filter(Boolean),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    throw error;
  }
}

/**
 * リストの更新・メンバー切替。{ name, description, visibility } で
 * リスト自体を更新、{ member: { kind, id, active } } で
 * プロフィール/スレッドの出入りを切り替える。画面側の
 * PATCH /api/lists/[id]・PUT/DELETE .../profiles|threads と同じ関数。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  if (typeof listId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(listId)) {
    return NextResponse.json({ error: "リストの指定が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const member = body?.member as { kind?: unknown; id?: unknown; active?: unknown } | undefined;
    if (member) {
      const kind = member.kind === "thread" ? "thread" : member.kind === "profile" ? "profile" : null;
      const targetId = typeof member.id === "string" ? member.id : "";
      if (!kind || !targetId || typeof member.active !== "boolean") {
        return NextResponse.json({ error: "メンバーの指定が正しくありません。" }, { status: 400 });
      }
      const done = await setD1UserListMembership(database, viewer.id, listId, kind, targetId, member.active);
      if (!done) {
        return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
      }
      return NextResponse.json({ member: true, active: member.active });
    }
    const updated = await updateD1UserList(database, viewer.id, listId, body ?? {});
    if (!updated) {
      return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
    }
    const list = (await listD1UserLists(database, viewer.id)).find((item) => item.id === listId);
    return NextResponse.json({ list });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof UserListInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    throw error;
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  if (typeof listId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(listId)) {
    return NextResponse.json({ error: "リストの指定が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const deleted = await deleteD1UserList(database, viewer.id, listId);
    if (!deleted) {
      return NextResponse.json({ error: "リストが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "unavailable" }, { status: 503 });
    }
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    if (error instanceof DesktopHubAuthenticationError) {
      return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
    }
    throw error;
  }
}
