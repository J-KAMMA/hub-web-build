import { NextResponse } from "next/server";

import { createWorkRequest } from "@/lib/server/d1-work";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { WORK_HEADERS, readWorkJson, rejectWorkRequest, workErrorResponse } from "@/lib/server/work-route";

export const dynamic = "force-dynamic";

/**
 * 依頼を作る。契約 ID が返るだけで、まだ入金されていない。作り手には入金が確かめられるまで見えない。
 * 支払は Commerce の画面で、ブラウザが Hub の札を持って移る (Hub は決済を中継しない)。
 */
export async function POST(request: Request) {
  const rejected = rejectWorkRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const created = await createWorkRequest(database, profile.id, await readWorkJson(request));
    return NextResponse.json({ contractId: created.contractId }, { status: 201, headers: WORK_HEADERS });
  } catch (error) {
    return workErrorResponse(error);
  }
}
