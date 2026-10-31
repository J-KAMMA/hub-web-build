import { NextResponse } from "next/server";

import { MAX_AVATAR_BYTES } from "@/lib/avatar-image";
import { readCommunityImage } from "@/lib/server/community-image-storage";
import { getHubMedia } from "@/lib/server/hub-d1";
import { r2ResponseStream } from "@/lib/server/r2-response-stream";

export async function GET(
  _request: Request,
  context: { params: Promise<{ communityId: string; version: string }> },
) {
  try {
    const { communityId, version } = await context.params;
    const object = await readCommunityImage(getHubMedia(), communityId, version);
    if (!object || object.size > MAX_AVATAR_BYTES) return new NextResponse(null, { status: 404 });
    return new Response(r2ResponseStream(object.body), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        ETag: object.httpEtag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
