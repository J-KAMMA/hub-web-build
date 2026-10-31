import { NextResponse } from "next/server";

import { contentFileDepsFromEnv, removeContentFile } from "@/lib/server/content-files";
import { NO_STORE, contentFileErrorResponse, rejectContentFileRequest } from "@/lib/server/content-files-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/** The author takes one attachment off (unpublished at the file component first). */
export async function DELETE(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const rejected = rejectContentFileRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { fileId } = await params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const result = await removeContentFile(database, contentFileDepsFromEnv(), profile.id, fileId);
    return NextResponse.json(result, { status: result.pending ? 202 : 200, headers: NO_STORE });
  } catch (error) {
    return contentFileErrorResponse(error);
  }
}
