import { NextResponse } from "next/server";

import { setWorkPublication } from "@/lib/server/d1-work";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { WORK_HEADERS, readWorkJson, rejectWorkRequest, workErrorResponse } from "@/lib/server/work-route";

export const dynamic = "force-dynamic";

/** Client: { publication: "private" | "public" }. Worker: { listed: boolean }. Only after release. */
export async function POST(request: Request, context: { params: Promise<{ contractId: string }> }) {
  const rejected = rejectWorkRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { contractId } = await context.params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    await setWorkPublication(database, profile.id, contractId, await readWorkJson(request));
    return NextResponse.json({ ok: true }, { headers: WORK_HEADERS });
  } catch (error) {
    return workErrorResponse(error);
  }
}
