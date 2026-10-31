import { NextResponse } from "next/server";

import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { issueWorkFileDownloadTicket, syncWorkContractState } from "@/lib/server/d1-work";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { WORK_HEADERS, readWorkJson, rejectWorkRequest, workErrorResponse, workStateDeps } from "@/lib/server/work-route";

export const dynamic = "force-dynamic";

/** { fileId }. A single-use file ticket, only after Commerce's signed state says the escrow was released. */
export async function POST(request: Request, context: { params: Promise<{ contractId: string }> }) {
  const rejected = rejectWorkRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { contractId } = await context.params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const body = await readWorkJson(request);
    const deps = contentFileDepsFromEnv();
    await syncWorkContractState(database, contractId, workStateDeps(), deps);
    return NextResponse.json(await issueWorkFileDownloadTicket(database, deps, profile.id, contractId, body.fileId), { headers: WORK_HEADERS });
  } catch (error) {
    return workErrorResponse(error);
  }
}
