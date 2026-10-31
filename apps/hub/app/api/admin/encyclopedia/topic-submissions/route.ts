import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { listHubpediaTopicSubmissions } from "@/lib/server/hubpedia-topic-submissions";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) return denied;
  const url = new URL(request.url);
  try {
    return NextResponse.json(
      await listHubpediaTopicSubmissions(getHubD1(), url.searchParams.get("status"), Number(url.searchParams.get("limit") ?? "50")),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "題材の投稿を取得できませんでした。" }, { status: 500 });
  }
}
