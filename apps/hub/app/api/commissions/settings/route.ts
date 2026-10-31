import { NextResponse } from "next/server";

import { getWorkOffer, saveWorkOffer } from "@/lib/server/d1-work";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { WORK_HEADERS, readWorkJson, rejectWorkRequest, workErrorResponse } from "@/lib/server/work-route";

export const dynamic = "force-dynamic";

/** The signed-in creator's own offer settings (受付設定). */
export async function GET(request: Request) {
  const rejected = rejectWorkRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json({ offer: await getWorkOffer(database, profile.id) }, { headers: WORK_HEADERS });
  } catch (error) {
    return workErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const rejected = rejectWorkRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json({ offer: await saveWorkOffer(database, profile.id, await readWorkJson(request)) }, { headers: WORK_HEADERS });
  } catch (error) {
    return workErrorResponse(error);
  }
}
