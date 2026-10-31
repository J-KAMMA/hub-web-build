import "server-only";

import { isServerName } from "@jkamma/hub-world/registry";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

/**
 * サーバを通報する。
 *
 * **届け出たサーバはそのまま公開になる。** 通報は、その後で人が気付くための合図。
 *
 * **ここでは状態を変えない。** 一度は「5件で自動的に下ろす」形にしたが外した——
 * Hub はサーバの中を見られないので、通報は確かめようのない申し立てになる。
 * それで機械が下ろすと、口座を揃えれば他人の店を消せる道具になる。
 * 下ろすのは人（/api/admin/world-servers）。
 *
 * 同じ人が何度押しても1つ（記録の主キーで担保）。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
): Promise<Response> {
  const { name } = await params;
  if (!isServerName(name)) return Response.json({ error: "ありません" }, { status: 404 });

  const database = getHubD1();
  let me;
  try {
    me = await requireHubSessionProfile(request);
  } catch {
    return Response.json({ error: "ログインが要ります" }, { status: 401 });
  }

  let reason = "";
  try {
    const body = await request.json() as { reason?: unknown };
    if (typeof body?.reason === "string") reason = body.reason.slice(0, 200);
  } catch {
    // 理由は無くてよい。**押せることの方が大事。**
  }

  // 在ることだけ確かめる。**中身の判定はしない。**
  const found = await database
    .prepare("SELECT name FROM WorldServer WHERE name = ? LIMIT 1")
    .bind(name)
    .first<{ name: string }>();
  if (!found) return Response.json({ error: "ありません" }, { status: 404 });

  await database
    .prepare(`INSERT INTO WorldServerReport (serverName, reporterId, reason, createdAt)
      VALUES (?, ?, ?, ?) ON CONFLICT(serverName, reporterId) DO NOTHING`)
    .bind(name, me.id, reason, new Date().toISOString())
    .run();

  // **何件届いているかは返さない。** 残り何件で下ろせるかが分かると、
  // 狙って集める道具になる。
  return Response.json({ reported: true });
}
