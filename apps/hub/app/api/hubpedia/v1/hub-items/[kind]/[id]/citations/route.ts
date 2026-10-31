import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { isHubEvidenceKind, listArticlesCitingHubItem } from "@/lib/server/hubpedia-hub-evidence";
import { enforceMcpRateLimit, rateHeaders } from "@/lib/server/hubpedia-mcp-public";

// 材料の側から「この項目を引いている事典」へ戻る。公開済みの記事だけを返す。
// 材料にできない項目(非公開・削除・外された)は存在を明かさず空配列を返す。
export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isHubEvidenceKind(kind)) {
    return NextResponse.json({ error: "Unknown item kind." }, { status: 404 });
  }
  const database = getHubD1();
  const rate = await enforceMcpRateLimit(database, request, "read");
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: rateHeaders(rate) });
  }
  const citations = await listArticlesCitingHubItem(database, kind, id);
  return NextResponse.json(
    { kind, id, citations },
    { headers: { "cache-control": "public, max-age=60", "x-content-type-options": "nosniff", ...rateHeaders(rate) } },
  );
}
