import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  HubpediaCandidateInputError,
  HubpediaCandidateRateLimitError,
  submitHubpediaArticleCandidate,
} from "@/lib/server/hubpedia-article-candidates";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function POST(request: Request) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  try {
    const db = getHubD1();
    const actor = await requireHubSessionProfile(request, db);
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input) return NextResponse.json({ error: "入力を確認してください。" }, { status: 400 });
    return NextResponse.json(await submitHubpediaArticleCandidate(db, actor, input), { status: 202 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof HubpediaCandidateRateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof HubpediaCandidateInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
