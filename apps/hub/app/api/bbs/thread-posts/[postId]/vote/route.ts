import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { ThreadPostVoteError, toggleD1ThreadPostVote } from "@/lib/server/d1-thread-post-votes";
import { saveVoteReason } from "@/lib/server/d1-thread-knowledge";
import { THREAD_VOTE_REASONS, type ThreadVoteReason } from "@/lib/thread-knowledge";

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { kind?: unknown; reason?: unknown } | null;
    if (body?.kind !== "up" && body?.kind !== "down") {
      return NextResponse.json({ error: "評価の種類が正しくありません。" }, { status: 400 });
    }
    const { postId } = await params;
    const summary = await toggleD1ThreadPostVote(database, {
      postId,
      profileId: viewer.id,
      profileJoinedAt: viewer.joinedAt,
      kind: body.kind,
    });
    const reason = THREAD_VOTE_REASONS.includes(body.reason as ThreadVoteReason) ? body.reason as ThreadVoteReason : null;
    await saveVoteReason(database, postId, viewer.id, summary.viewerVote === "down" ? reason : null);
    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof ThreadPostVoteError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
