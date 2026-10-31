import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { UserList } from "@/lib/domain";

type ListRow = {
  id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  sort_order: number;
};
type MembershipRow = { list_id: string; target_id: string };

export class UserListInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserListInputError";
  }
}

function normalizedListInput(input: {
  name?: unknown;
  description?: unknown;
  visibility?: unknown;
}) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const visibility = input.visibility === "public" ? "public" : input.visibility === "private" ? "private" : null;
  if (!name || name.length > 100) throw new UserListInputError("リスト名は1〜100文字で入力してください。");
  if (description.length > 1000) throw new UserListInputError("説明は1,000文字以内で入力してください。");
  if (!visibility) throw new UserListInputError("公開範囲を選択してください。");
  return { name, description, visibility };
}

export async function listD1UserLists(
  database: D1Database,
  ownerProfileId: string,
): Promise<UserList[]> {
  const [lists, profiles, threads] = await Promise.all([
    database.prepare(`SELECT id, name, description, visibility, sort_order
      FROM user_lists WHERE owner_profile_id = ? ORDER BY sort_order, created_at`)
      .bind(ownerProfileId).all<ListRow>(),
    database.prepare(`SELECT lp.list_id, lp.profile_id AS target_id
      FROM list_profiles lp JOIN user_lists ul ON ul.id = lp.list_id
      WHERE ul.owner_profile_id = ? ORDER BY lp.position, lp.added_at`)
      .bind(ownerProfileId).all<MembershipRow>(),
    database.prepare(`SELECT lt.list_id, lt.thread_id AS target_id
      FROM list_threads lt JOIN user_lists ul ON ul.id = lt.list_id
      WHERE ul.owner_profile_id = ? ORDER BY lt.position, lt.added_at`)
      .bind(ownerProfileId).all<MembershipRow>(),
  ]);
  const profileIds = new Map<string, string[]>();
  const threadIds = new Map<string, string[]>();
  for (const row of profiles.results) {
    profileIds.set(row.list_id, [...(profileIds.get(row.list_id) ?? []), row.target_id]);
  }
  for (const row of threads.results) {
    threadIds.set(row.list_id, [...(threadIds.get(row.list_id) ?? []), row.target_id]);
  }
  return lists.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    order: Number(row.sort_order),
    profileIds: profileIds.get(row.id) ?? [],
    threadIds: threadIds.get(row.id) ?? [],
  }));
}

/* 画面の列に並べるだけの軽い読み出し。id と名前だけ、最大 limit+1 行（超過の有無を知るため）。 */
export async function listD1UserListLabels(
  database: D1Database,
  ownerProfileId: string,
  limit: number,
): Promise<{ id: string; name: string }[]> {
  const result = await database.prepare(`SELECT id, name FROM user_lists
    WHERE owner_profile_id = ? ORDER BY sort_order, created_at LIMIT ?`)
    .bind(ownerProfileId, Math.max(1, Math.trunc(limit)) + 1).all<{ id: string; name: string }>();
  return result.results ?? [];
}

export async function createD1UserList(
  database: D1Database,
  ownerProfileId: string,
  input: { name?: unknown; description?: unknown; visibility?: unknown },
) {
  const value = normalizedListInput(input);
  const count = await database.prepare(
    "SELECT COUNT(*) AS count FROM user_lists WHERE owner_profile_id = ?",
  ).bind(ownerProfileId).first<{ count: number }>();
  if (Number(count?.count ?? 0) >= 20) throw new UserListInputError("作成できるリストは20件までです。");
  const order = await database.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM user_lists WHERE owner_profile_id = ?",
  ).bind(ownerProfileId).first<{ next_order: number }>();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO user_lists
    (id, owner_profile_id, name, description, visibility, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, ownerProfileId, value.name, value.description, value.visibility, Number(order?.next_order ?? 0), now, now)
    .run();
  return (await listD1UserLists(database, ownerProfileId)).find((list) => list.id === id)!;
}

export async function updateD1UserList(
  database: D1Database,
  ownerProfileId: string,
  listId: string,
  input: { name?: unknown; description?: unknown; visibility?: unknown },
) {
  const value = normalizedListInput(input);
  const result = await database.prepare(`UPDATE user_lists
    SET name = ?, description = ?, visibility = ?, updated_at = ?
    WHERE id = ? AND owner_profile_id = ?`)
    .bind(value.name, value.description, value.visibility, new Date().toISOString(), listId, ownerProfileId)
    .run();
  return Boolean(result.meta.changes);
}

export async function deleteD1UserList(
  database: D1Database,
  ownerProfileId: string,
  listId: string,
) {
  const result = await database.prepare(
    "DELETE FROM user_lists WHERE id = ? AND owner_profile_id = ?",
  ).bind(listId, ownerProfileId).run();
  return Boolean(result.meta.changes);
}

export async function reorderD1UserList(
  database: D1Database,
  ownerProfileId: string,
  listId: string,
  direction: "up" | "down",
) {
  const rows = await database.prepare(`SELECT id, sort_order FROM user_lists
    WHERE owner_profile_id = ? ORDER BY sort_order, created_at`)
    .bind(ownerProfileId).all<{ id: string; sort_order: number }>();
  const index = rows.results.findIndex((row) => row.id === listId);
  if (index < 0) return false;
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  const neighbor = rows.results[neighborIndex];
  const current = rows.results[index];
  if (!neighbor) return true;
  const now = new Date().toISOString();
  await database.batch([
    database.prepare("UPDATE user_lists SET sort_order = ?, updated_at = ? WHERE id = ? AND owner_profile_id = ?")
      .bind(neighbor.sort_order, now, current.id, ownerProfileId),
    database.prepare("UPDATE user_lists SET sort_order = ?, updated_at = ? WHERE id = ? AND owner_profile_id = ?")
      .bind(current.sort_order, now, neighbor.id, ownerProfileId),
  ]);
  return true;
}

export async function setD1UserListMembership(
  database: D1Database,
  ownerProfileId: string,
  listId: string,
  kind: "profile" | "thread",
  targetId: string,
  active: boolean,
) {
  const list = await database.prepare(
    "SELECT id FROM user_lists WHERE id = ? AND owner_profile_id = ? LIMIT 1",
  ).bind(listId, ownerProfileId).first();
  if (!list) return false;
  const table = kind === "profile" ? "list_profiles" : "list_threads";
  const targetColumn = kind === "profile" ? "profile_id" : "thread_id";
  if (active) {
    const targetTable = kind === "profile" ? "profiles" : "threads";
    const target = await database.prepare(`SELECT id FROM ${targetTable} WHERE id = ? LIMIT 1`)
      .bind(targetId).first();
    if (!target) throw new UserListInputError(
      kind === "profile" ? "プロフィールが見つかりません。" : "スレッドが見つかりません。",
    );
    const position = await database.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM ${table} WHERE list_id = ?`,
    ).bind(listId).first<{ next_position: number }>();
    await database.prepare(`INSERT INTO ${table} (list_id, ${targetColumn}, position, added_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(list_id, ${targetColumn}) DO NOTHING`)
      .bind(listId, targetId, Number(position?.next_position ?? 0), new Date().toISOString()).run();
  } else {
    await database.prepare(`DELETE FROM ${table} WHERE list_id = ? AND ${targetColumn} = ?`)
      .bind(listId, targetId).run();
  }
  return true;
}
