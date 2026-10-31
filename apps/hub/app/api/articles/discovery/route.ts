import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { listArticleDiscoveryPage } from "@/lib/server/article-discovery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const createdAt = params.get("before");
  const id = params.get("id");
  if ((createdAt !== null || id !== null) && (!createdAt || !id || createdAt.length > 64 || id.length > 200 || !Number.isFinite(Date.parse(createdAt)))) {
    return NextResponse.json({ error: "Invalid article cursor" }, { status: 400 });
  }
  try {
    const result = await listArticleDiscoveryPage(getHubD1(), createdAt && id ? { createdAt, id } : null);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "記事を読み込めませんでした。" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
