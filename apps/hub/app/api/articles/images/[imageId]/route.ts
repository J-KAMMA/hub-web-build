import { NextResponse } from "next/server";

import { hasAdultOptIn } from "@/lib/adult/opt-in";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { findServableArticleImage } from "@/lib/server/d1-user-article-drafts";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "画像が見つかりません。" }, { status: 404, headers: { "cache-control": "private, no-store" } });

/**
 * 記事の画像。公開中の記事の画像と、著者本人の下書きの画像だけを返す。
 * 取り下げ・運営非表示・閲覧条件付き・成人向け（未有効）は404にして、あることも知らせない。
 * 取り下げが即時に効くよう、キャッシュさせない。
 */
export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  const variant = new URL(request.url).searchParams.get("variant") === "thumbnail" ? "thumbnail" : "full";
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
    const image = await findServableArticleImage(database, imageId, viewer?.id ?? null);
    if (!image) return NOT_FOUND();
    if (image.audience === "adult" && !(await hasAdultOptIn())) return NOT_FOUND();
    const key = variant === "thumbnail" ? image.thumbnailObjectKey ?? image.objectKey : image.objectKey;
    const object = await getHubMedia().get(key);
    if (!object) return NOT_FOUND();
    return new Response(await object.arrayBuffer(), {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return NOT_FOUND();
  }
}
