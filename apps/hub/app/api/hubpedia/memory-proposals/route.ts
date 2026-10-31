import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import {
  HubpediaMemoryProposalInputError,
  HubpediaMemoryProposalRateLimitError,
  listProfileHubpediaMemoryProposals,
  submitHubpediaMemoryProposal,
} from "@/lib/server/hubpedia-memory-proposals";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const db = getHubD1();
    const profile = await requireHubSessionProfile(request, db);
    return NextResponse.json(
      await listProfileHubpediaMemoryProposals(db, profile.id),
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: privateHeaders });
    }
    return NextResponse.json({ error: "記憶候補を取得できませんでした。" }, { status: 500, headers: privateHeaders });
  }
}

export async function POST(request: Request) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  try {
    const db = getHubD1();
    const profile = await requireHubSessionProfile(request, db);
    const input = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!input) return NextResponse.json({ error: "入力を確認してください。" }, { status: 400, headers: privateHeaders });
    const proposal = await submitHubpediaMemoryProposal(db, { profileId: profile.id, type: "human" }, input);
    return NextResponse.json(proposal, { status: 202, headers: privateHeaders });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: privateHeaders });
    }
    if (error instanceof HubpediaMemoryProposalRateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: privateHeaders });
    }
    if (error instanceof HubpediaMemoryProposalInputError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: privateHeaders });
    }
    return NextResponse.json({ error: "記憶候補を受け付けられませんでした。" }, { status: 500, headers: privateHeaders });
  }
}
