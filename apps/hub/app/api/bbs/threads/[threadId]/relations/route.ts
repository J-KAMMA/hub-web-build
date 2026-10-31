import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

const RELATIONS = ["related", "duplicate", "continuation", "merged"];

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const db = getHubD1();
    const viewer = await requireHubSessionProfile(request, db);
    const { threadId } = await params;
    const body = await request.json() as { targetThreadId?: unknown; relation?: unknown };
    const owner = await db.prepare("SELECT created_by_profile_id FROM threads WHERE id=?").bind(threadId).first<{ created_by_profile_id: string | null }>();
    if (owner?.created_by_profile_id !== viewer.id) return NextResponse.json({ error: "作成者だけが関連付けできます。" }, { status: 403 });
    const target = String(body.targetThreadId ?? "").trim();
    const relation = String(body.relation ?? "related");
    if (!target || target === threadId || !RELATIONS.includes(relation)) return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
    // The target must exist and be visible to readers (archived threads are not listed); otherwise the
    // relation would reveal or link to a thread the requester cannot see.
    const visible = await db.prepare("SELECT 1 AS ok FROM threads WHERE id=? AND status <> 'archived'").bind(target).first();
    if (!visible) return NextResponse.json({ error: "関連付け先のスレッドが見つかりません。" }, { status: 404 });
    await db.prepare(`INSERT INTO thread_relations(source_thread_id,target_thread_id,relation,created_by_profile_id,created_at)VALUES(?,?,?,?,?) ON CONFLICT(source_thread_id,target_thread_id)DO UPDATE SET relation=excluded.relation`)
      .bind(threadId, target, relation, viewer.id, new Date().toISOString()).run();
    return NextResponse.json({ saved: true });
  } catch (e) {
    if (e instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "関連付けできませんでした。" }, { status: 400 });
  }
}
