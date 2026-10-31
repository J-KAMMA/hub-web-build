import { NextResponse } from "next/server";

import { createAccessGate, listAccessGatesForOwner, listAccessGateUsageForOwner } from "@/lib/server/access-gates";
import {
  NO_STORE,
  accessGateErrorResponse,
  readJson,
  rejectCrossOrigin,
} from "@/lib/server/access-gates-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/** The signed-in creator's own gates. */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const [gates, usage] = await Promise.all([listAccessGatesForOwner(database, profile.id), listAccessGateUsageForOwner(database, profile.id)]);
    return NextResponse.json({ gates, usage }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const gate = await createAccessGate(database, profile.id, await readJson(request));
    return NextResponse.json({ gate }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}
