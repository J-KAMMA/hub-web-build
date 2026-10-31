import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function POST(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params;
  const payload = await request.json().catch(() => ({})) as { targetCommunityId?: string; reason?: string };
  try {
    const database = getHubD1(); const actor = await requireHubSessionProfile(request, database);
    const target = String(payload.targetCommunityId ?? "");
    const reason = String(payload.reason ?? "").normalize("NFKC").trim().slice(0, 500);
    if (!target || target === communityId || reason.length < 10) throw new Error("重複先と10文字以上の理由を入力してください。");
    const exists = await database.prepare(`SELECT id FROM communities WHERE id IN (?, ?) AND lifecycle_status = 'active'`).bind(communityId, target).all();
    if (exists.results.length !== 2) throw new Error("対象コミュニティが見つかりません。");
    await database.prepare(`INSERT INTO community_duplicate_reports
      (id, source_community_id, target_community_id, reporter_profile_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_community_id, target_community_id, reporter_profile_id) DO UPDATE SET reason = excluded.reason, status = 'open', created_at = excluded.created_at`)
      .bind(crypto.randomUUID(), communityId, target, actor.id, reason, new Date().toISOString()).run();
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "重複報告を送信できませんでした。" }, { status: 400 }); }
}
