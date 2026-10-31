import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const SEARCH_INDEXES = [
  { index: "profiles_fts", source: "profiles" },
  { index: "threads_fts", source: "threads" },
  { index: "thread_posts_fts", source: "thread_posts" },
  { index: "social_posts_fts", source: "social_posts" },
  { index: "hubpedia_articles_fts", source: "hubpedia_articles" },
] as const;

type CountRow = { count: number };

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) || requireSameOrigin(request);
  if (denied) return denied;
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const startedAt = performance.now();
  const at = new Date().toISOString();
  await database.batch(SEARCH_INDEXES.map(({ index }) =>
    database.prepare(`INSERT INTO ${index}(${index}) VALUES('rebuild')`)));

  const indexes = [];
  for (const { index, source } of SEARCH_INDEXES) {
    const indexCount = await database.prepare(`SELECT count(*) AS count FROM ${index}`).first<CountRow>();
    const sourceCount = await database.prepare(`SELECT count(*) AS count FROM ${source}`).first<CountRow>();
    indexes.push({
      index,
      source,
      indexCount: Number(indexCount?.count ?? -1),
      sourceCount: Number(sourceCount?.count ?? -1),
      matches: indexCount?.count === sourceCount?.count,
    });
  }

  const durationMs = Math.max(0, performance.now() - startedAt);
  const healthy = indexes.every((item) => item.matches);
  const metadata = JSON.stringify({ durationMs: Math.round(durationMs), healthy, indexes });
  await database.prepare(`INSERT INTO hub_admin_audit_log
    (id,actor_role,action,target_type,target_id,metadata_json,created_at)
    VALUES(?,'operations_admin','search.rebuild','system','fts',?,?)`)
    .bind(crypto.randomUUID(), metadata, at).run();

  return NextResponse.json(
    { rebuilt: true, healthy, at, durationMs: Math.round(durationMs), indexes },
    { status: healthy ? 200 : 500 },
  );
}
