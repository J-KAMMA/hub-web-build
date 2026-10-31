import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { listHubpediaArticleCandidates } from "@/lib/server/hubpedia-article-candidates";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  try {
    return NextResponse.json(
      await listHubpediaArticleCandidates(getHubD1(), url.searchParams.get("status"), limit),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "記事候補を取得できませんでした。" }, { status: 500 });
  }
}
