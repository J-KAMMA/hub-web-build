import { NextResponse } from "next/server";

import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { registerWorkDelivery, syncWorkContractState } from "@/lib/server/d1-work";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { WORK_HEADERS, readWorkJson, rejectWorkRequest, workErrorResponse, workStateDeps } from "@/lib/server/work-route";

export const dynamic = "force-dynamic";

/**
 * { fileIds }. The worker already uploaded the files straight to the file component with an upload ticket
 * from POST /api/content-files. This seals them as the delivery and returns the fingerprint to record on chain.
 */
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
    const sealed = await registerWorkDelivery(database, deps, profile.id, contractId, body.fileIds);
    return NextResponse.json(
      { deliveryHash: sealed.hash, files: sealed.files.map((file) => ({ id: file.id, name: file.name, size: file.size })) },
      { status: 201, headers: WORK_HEADERS },
    );
  } catch (error) {
    return workErrorResponse(error);
  }
}
