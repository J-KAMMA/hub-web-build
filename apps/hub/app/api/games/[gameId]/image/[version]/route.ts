import { NextResponse } from "next/server";
import { getHubMedia } from "@/lib/server/hub-d1";
import { readGameImage } from "@/lib/server/game-image-storage";
import { r2ResponseStream } from "@/lib/server/r2-response-stream";

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string; version: string }> }) {
  const { gameId, version } = await params;
  const object = await readGameImage(getHubMedia(), gameId, version);
  if (!object) return new NextResponse(null, { status: 404 });
  return new Response(r2ResponseStream(object.body), { headers: {
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
    ETag: object.httpEtag,
    "X-Content-Type-Options": "nosniff",
  } });
}
