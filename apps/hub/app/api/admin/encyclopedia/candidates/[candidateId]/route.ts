import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubpediaCandidateInputError,
  reviewHubpediaArticleCandidate,
} from "@/lib/server/hubpedia-article-candidates";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "審査内容が正しくありません。" }, { status: 400 });
  }
  try {
    const { candidateId } = await context.params;
    return NextResponse.json({
      candidate: await reviewHubpediaArticleCandidate(
        getHubD1(),
        candidateId,
        input as Record<string, unknown>,
      ),
    });
  } catch (error) {
    if (error instanceof HubpediaCandidateInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "記事候補を審査できませんでした。" }, { status: 500 });
  }
}
