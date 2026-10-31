import { NextResponse } from "next/server";

import { ContentDownloadError } from "@/lib/server/content-downloads";
import { consumeImageDownload } from "@/lib/server/content-download-images";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET: consume a single-use image download grant and return the watermarked image. */
export async function GET(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  try {
    const { grantId } = await params;
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
    return await consumeImageDownload(database, getHubMedia(), viewer?.id ?? null, grantId);
  } catch (error) {
    if (error instanceof ContentDownloadError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "ダウンロードを準備できませんでした。" }, { status: 503, headers: NO_STORE });
  }
}
