import { NextResponse } from "next/server";

import { isContentDownloadKind } from "@/lib/content-download-policy";
import { NO_STORE, readJson, rejectCrossOrigin } from "@/lib/server/access-gates-route";
import { ContentFileError, contentFileDepsFromEnv, issueContentFileDownloadTicket } from "@/lib/server/content-files";
import { ContentDownloadError, issueMusicDownload, issueVideoDownload } from "@/lib/server/content-downloads";
import { contentDownloadDepsFromEnv } from "@/lib/server/content-downloads-env";
import { issueImageDownload } from "@/lib/server/content-download-images";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/**
 * POST { kind: "file" | "video" | "music" | "image", id } (2026-10-17).
 * Hub checks the creator's setting, the viewer's entitlement, the hidden and publish state, and
 * only then returns a same-origin URL holding a single-use download ticket. Hub never streams
 * video, music or file bodies.
 */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const input = await readJson(request);
    const body = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    if (!isContentDownloadKind(body.kind)) {
      return NextResponse.json({ error: "ダウンロードの種類が正しくありません。" }, { status: 400, headers: NO_STORE });
    }
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
    const viewerId = viewer?.id ?? null;
    const download =
      body.kind === "file"
        ? await issueContentFileDownloadTicket(database, contentFileDepsFromEnv(), viewerId, body.id)
        : body.kind === "image"
          ? await issueImageDownload(database, viewerId, body.id)
          : body.kind === "video"
            ? await issueVideoDownload(database, contentDownloadDepsFromEnv(), viewerId, body.id)
            : await issueMusicDownload(database, contentDownloadDepsFromEnv(), viewerId, body.id);
    return NextResponse.json({ download }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ContentDownloadError || error instanceof ContentFileError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "ダウンロードを準備できませんでした。" }, { status: 503, headers: NO_STORE });
  }
}
