import { NextResponse } from "next/server";
import type { R2Object, R2Range } from "@cloudflare/workers-types";

import { findHubBookVolume } from "@/lib/books/library";
import { bookRangeIsSatisfiable, parseBookRangeHeader } from "@/lib/books/range";
import { getHubMedia, HubMediaUnavailableError } from "@/lib/server/hub-d1";
import { r2ResponseStream } from "@/lib/server/r2-response-stream";

type RouteContext = { params: Promise<{ bookId: string; volume: string }> };

const BASE_HEADERS = {
  "Accept-Ranges": "bytes",
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  "Content-Disposition": "inline",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

function responseHeaders(object: R2Object, ranged: boolean) {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", "application/pdf");
  headers.set("ETag", object.httpEtag);
  if (!ranged || !object.range) {
    headers.set("Content-Length", String(object.size));
    return headers;
  }

  const range = object.range;
  const length = "suffix" in range
    ? Math.min(range.suffix, object.size)
    : Math.min(range.length ?? object.size - (range.offset ?? 0), object.size - (range.offset ?? 0));
  const start = "suffix" in range
    ? object.size - length
    : range.offset ?? 0;
  headers.set("Content-Length", String(length));
  headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
  return headers;
}

function rangeNotSatisfiable(size?: number) {
  const headers = new Headers(BASE_HEADERS);
  if (size !== undefined) headers.set("Content-Range", `bytes */${size}`);
  return new NextResponse(null, { status: 416, headers });
}

export async function HEAD(_request: Request, context: RouteContext) {
  const { bookId, volume } = await context.params;
  const entry = await findHubBookVolume(bookId, volume);
  if (!entry) return new NextResponse(null, { status: 404 });
  try {
    const object = await getHubMedia().head(entry.volume.objectKey);
    if (!object) return new NextResponse(null, { status: 404, headers: BASE_HEADERS });
    return new NextResponse(null, { status: 200, headers: responseHeaders(object, false) });
  } catch (error) {
    if (error instanceof HubMediaUnavailableError) {
      return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { bookId, volume } = await context.params;
  const entry = await findHubBookVolume(bookId, volume);
  if (!entry) return new NextResponse(null, { status: 404 });
  try {
    const ranged = request.headers.has("range");
    const range = parseBookRangeHeader(request.headers.get("range"));
    if (ranged && !range) {
      return rangeNotSatisfiable();
    }
    if (range) {
      const metadata = await getHubMedia().head(entry.volume.objectKey);
      if (!metadata) return new NextResponse(null, { status: 404, headers: BASE_HEADERS });
      if (!bookRangeIsSatisfiable(range, metadata.size)) return rangeNotSatisfiable(metadata.size);
    }
    const object = await getHubMedia().get(entry.volume.objectKey, range ? { range } : undefined);
    if (!object || !("body" in object)) {
      return new NextResponse(null, { status: 404, headers: BASE_HEADERS });
    }
    return new Response(r2ResponseStream(object.body), {
      status: ranged ? 206 : 200,
      headers: responseHeaders(object, ranged),
    });
  } catch (error) {
    if (error instanceof HubMediaUnavailableError) {
      return NextResponse.json({ error: "book_storage_unavailable" }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    throw error;
  }
}
