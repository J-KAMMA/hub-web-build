import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubpediaMemoryProposalInputError,
  reviewHubpediaMemoryProposal,
} from "@/lib/server/hubpedia-memory-proposals";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

export async function PATCH(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "審査内容が正しくありません。" }, { status: 400 });
  }
  try {
    const { proposalId } = await context.params;
    return NextResponse.json({
      proposal: await reviewHubpediaMemoryProposal(
        getHubD1(), proposalId, input as Record<string, unknown>,
      ),
    });
  } catch (error) {
    if (error instanceof HubpediaMemoryProposalInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "記憶候補を審査できませんでした。" }, { status: 500 });
  }
}
