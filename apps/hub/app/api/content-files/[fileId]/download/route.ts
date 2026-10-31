import { NextResponse } from "next/server";

import { contentFileDepsFromEnv, issueContentFileDownloadTicket } from "@/lib/server/content-files";
import { NO_STORE, contentFileErrorResponse, rejectContentFileRequest } from "@/lib/server/content-files-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/**
 * A single-use download ticket, issued only after Hub's server-side gate check for this viewer.
 * The response holds a same-origin URL on the file component; Hub never streams the file.
 */
export async function POST(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const rejected = rejectContentFileRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { fileId } = await params;
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
    const download = await issueContentFileDownloadTicket(database, contentFileDepsFromEnv(), viewer?.id ?? null, fileId);
    return NextResponse.json({ download }, { headers: NO_STORE });
  } catch (error) {
    return contentFileErrorResponse(error);
  }
}
