import { NextResponse } from "next/server";

import {
  contentFileDepsFromEnv,
  issueContentFileUploadTicket,
  listContentFiles,
  listOwnUnattachedFiles,
  parseContentFileRef,
} from "@/lib/server/content-files";
import { NO_STORE, contentFileErrorResponse, rejectContentFileRequest } from "@/lib/server/content-files-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/**
 * Upload ticket for one gated file attachment: { fileName, sizeBytes }.
 * The browser POSTs the file directly to the returned `path` with the ticket header;
 * Hub never receives the file body.
 */
export async function POST(request: Request) {
  const rejected = rejectContentFileRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const upload = await issueContentFileUploadTicket(database, contentFileDepsFromEnv(), profile.id, {
      fileName: input?.fileName,
      sizeBytes: input?.sizeBytes,
    });
    return NextResponse.json({ upload }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return contentFileErrorResponse(error);
  }
}

/**
 * ?targetType=post|article&targetId=… : files on gated content, only for the author or a viewer
 * whose gate check passes. ?unattached=1 : the signed-in author's own unattached uploads.
 */
export async function GET(request: Request) {
  const rejected = rejectContentFileRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const params = new URL(request.url).searchParams;
    if (params.get("unattached") === "1") {
      const profile = await requireHubSessionProfile(request, database);
      return NextResponse.json({ files: await listOwnUnattachedFiles(database, profile.id) }, { headers: NO_STORE });
    }
    const ref = parseContentFileRef(params.get("targetType"), params.get("targetId"));
    const viewer = await getOptionalHubSessionProfile(request, database).catch(() => null);
    const listed = await listContentFiles(database, contentFileDepsFromEnv(), viewer?.id ?? null, ref);
    return NextResponse.json(listed, { headers: NO_STORE });
  } catch (error) {
    return contentFileErrorResponse(error);
  }
}
