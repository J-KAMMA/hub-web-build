import { NextResponse } from "next/server";

import { attachContentFiles, contentFileDepsFromEnv, parseContentFileRef } from "@/lib/server/content-files";
import { NO_STORE, contentFileErrorResponse, rejectContentFileRequest } from "@/lib/server/content-files-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/**
 * Publish uploaded files on the author's gated post or article: { targetType, targetId, fileIds }.
 * Hub signs a publish ticket per file and sends the state change to the file component; each
 * result carries the component's scan status (the file-status read).
 */
export async function POST(request: Request) {
  const rejected = rejectContentFileRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const ref = parseContentFileRef(input?.targetType, input?.targetId);
    const files = await attachContentFiles(database, contentFileDepsFromEnv(), profile.id, ref, input?.fileIds);
    return NextResponse.json({ files }, { headers: NO_STORE });
  } catch (error) {
    return contentFileErrorResponse(error);
  }
}
