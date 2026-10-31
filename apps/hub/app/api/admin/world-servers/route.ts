import "server-only";

import {
  countReporters, isServerName, needsLooking, readServers
} from "@jkamma/hub-world/registry";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

/**
 * 届け出られたサーバを見て、下ろす／戻す。
 *
 * **下ろすのは人。** 通報で機械が下ろす形は外した——Hub はサーバの中を見られない
 * ので、通報は確かめようのない申し立てになる。それで機械が下ろすと、口座を
 * 揃えれば他人の店を消せる道具になる。
 *
 * ここは合図を並べるだけで、判断はしない。**判断する人が要る。**
 */

type Row = {
  name: string; title: string; about: string; operatorId: string;
  address: string; status: string; createdAt: string;
};

/** 通報の届いている順に並べて返す。**急いで見るものを上へ。** */
export async function GET(request: Request): Promise<Response> {
  const refused = requireModerationAdmin(request);
  if (refused) return refused;

  const database = getHubD1();
  const rows = await database
    .prepare(`SELECT name, title, about, operatorId, address, status, createdAt
      FROM WorldServer ORDER BY createdAt DESC LIMIT 300`)
    .all<Row>();
  const servers = readServers((rows.results ?? []).map((one) => ({
    name: one.name, title: one.title, about: one.about, operator: one.operatorId,
    address: one.address, status: one.status, at: Date.parse(one.createdAt) || 0
  })));

  const reports = await database
    .prepare("SELECT serverName, reporterId, reason FROM WorldServerReport LIMIT 5000")
    .all<{ serverName: string; reporterId: string; reason: string }>();
  const byServer = new Map<string, { reporters: string[]; reasons: string[] }>();
  for (const one of reports.results ?? []) {
    const held = byServer.get(one.serverName) ?? { reporters: [], reasons: [] };
    held.reporters.push(one.reporterId);
    if (one.reason) held.reasons.push(one.reason);
    byServer.set(one.serverName, held);
  }

  const listing = servers.map((server) => {
    const held = byServer.get(server.name) ?? { reporters: [], reasons: [] };
    return {
      name: server.name,
      title: server.title,
      about: server.about,
      address: server.address,
      status: server.status,
      operator: server.operator,
      reports: countReporters(server, held.reporters),
      // **理由は見る人のためのもの。** 判断の材料であって、判断ではない。
      reasons: held.reasons.slice(0, 20),
      looking: needsLooking(server, held.reporters)
    };
  });
  listing.sort((a, b) => Number(b.looking) - Number(a.looking) || b.reports - a.reports);

  return Response.json({ servers: listing });
}

/** 下ろす／戻す。**人が押したときだけ動く。** */
export async function POST(request: Request): Promise<Response> {
  const refused = requireModerationAdmin(request);
  if (refused) return refused;

  let body: { name?: unknown; status?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "読めません" }, { status: 400 });
  }
  if (!isServerName(body.name)) return Response.json({ error: "ありません" }, { status: 404 });
  const status = body.status;
  if (status !== "公開" && status !== "停止" && status !== "待ち") {
    return Response.json({ error: "その状態はありません" }, { status: 400 });
  }

  const done = await getHubD1()
    .prepare("UPDATE WorldServer SET status = ?, updatedAt = ? WHERE name = ?")
    .bind(status, new Date().toISOString(), body.name)
    .run();
  if (!done.meta.changes) return Response.json({ error: "ありません" }, { status: 404 });

  return Response.json({ name: body.name, status });
}
