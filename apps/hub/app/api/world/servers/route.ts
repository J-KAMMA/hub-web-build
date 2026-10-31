import "server-only";

import {
  listed, readServers, register, type WorldServer
} from "@jkamma/hub-world/registry";

import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/**
 * 3Dワールドのサーバの名簿。
 *
 * **第三者が建てる形にすると、繋ぎ先を人が手で貼ることになる。** それを避ける
 * ための口。判定は `@jkamma/hub-world/registry` にあり、ここは出し入れだけ。
 *
 * ## 入る前に、誰のサーバかを出す
 *
 * サーバの主は移動の審判なので、その世界に居る間の位置も発言も全部見える。
 * なりすましもできる。**これは建てさせるという選択そのもので、隠せない。**
 * だから一覧は必ず建てた人を添えて返す。
 */

type Row = {
  name: string;
  title: string;
  about: string;
  operatorId: string;
  address: string;
  status: string;
  createdAt: string;
};

const toServer = (row: Row): WorldServer => ({
  name: row.name,
  title: row.title,
  about: row.about,
  operator: row.operatorId,
  address: row.address,
  status: row.status as WorldServer["status"],
  at: Date.parse(row.createdAt) || 0
});

/** 一覧。**公開のものだけ。** 見る人が誰であっても同じものを返す。 */
export async function GET(request: Request): Promise<Response> {
  const database = getHubD1();
  // 見ている人が分かれば、自分の待ちのものも返す（自分の分は自分に見せる）。
  const me = await getOptionalHubViewerProfile(request, database);

  const rows = await database
    .prepare(`SELECT name, title, about, operatorId, address, status, createdAt
      FROM WorldServer WHERE status = '公開' OR operatorId = ?
      ORDER BY createdAt DESC LIMIT 200`)
    .bind(me?.id ?? "")
    .all<Row>();

  const all = readServers((rows.results ?? []).map(toServer));
  const open = listed(all);
  const mine = me ? all.filter((one) => one.operator === me.id && one.status !== "公開") : [];

  // 建てた人の表示名も添える。**識別子だけでは、誰か分からない。**
  const who = await namesOf(database, [...open, ...mine].map((one) => one.operator));

  return Response.json({
    servers: [...open, ...mine].map((one) => ({
      name: one.name,
      title: one.title,
      about: one.about,
      address: one.address,
      status: one.status,
      operator: { id: one.operator, displayName: who.get(one.operator) ?? "不明" }
    }))
  });
}

/**
 * 建てたことを届け出る。
 *
 * **既定は待ち。** 届け出ただけで一覧へ出すと、名簿がそのまま撒き場になる。
 */
export async function POST(request: Request): Promise<Response> {
  const database = getHubD1();
  let me;
  try {
    me = await requireHubSessionProfile(request);
  } catch {
    return Response.json({ error: "ログインが要ります" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "読めません" }, { status: 400 });
  }
  const wish = body as { name?: unknown; title?: unknown; about?: unknown; address?: unknown };

  const rows = await database
    .prepare(`SELECT name, title, about, operatorId, address, status, createdAt
      FROM WorldServer WHERE operatorId = ?`)
    .bind(me.id)
    .all<Row>();
  const mine = readServers((rows.results ?? []).map(toServer));

  const done = register(
    { name: wish.name, title: wish.title, about: wish.about, address: wish.address },
    me.id, mine, Date.now()
  );
  // **断る理由は返す。** 建てる人が直せるものなので、黙って落とすと直しようがない。
  if (!done.ok) return Response.json({ error: done.reason }, { status: 400 });

  const now = new Date().toISOString();
  try {
    await database
      .prepare(`INSERT INTO WorldServer (name, title, about, operatorId, address, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, '待ち', ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          title = excluded.title, about = excluded.about, address = excluded.address,
          updatedAt = excluded.updatedAt
        WHERE WorldServer.operatorId = excluded.operatorId`)
      .bind(done.server.name, done.server.title, done.server.about, me.id, done.server.address, now, now)
      .run();
  } catch {
    return Response.json({ error: "書けませんでした" }, { status: 500 });
  }

  // **他人の名前は奪えない。** 条件付きの更新なので、他人のものなら何も起きない。
  const after = await database
    .prepare("SELECT operatorId, status FROM WorldServer WHERE name = ?")
    .bind(done.server.name)
    .first<{ operatorId: string; status: string }>();
  if (after?.operatorId !== me.id) {
    return Response.json({ error: "その名前は使われています" }, { status: 409 });
  }

  return Response.json({ name: done.server.name, status: after.status }, { status: 201 });
}

/** 建てた人の表示名を引く。 */
async function namesOf(
  database: ReturnType<typeof getHubD1>,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean).slice(0, 200);
  if (unique.length === 0) return new Map();
  const marks = unique.map(() => "?").join(",");
  const rows = await database
    .prepare(`SELECT id, display_name FROM profiles WHERE id IN (${marks})`)
    .bind(...unique)
    .all<{ id: string; display_name: string }>();
  return new Map((rows.results ?? []).map((one) => [one.id, one.display_name]));
}
