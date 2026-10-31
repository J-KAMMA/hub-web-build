import { NextResponse } from "next/server";

import {
  AccessGateForbiddenError,
  AccessGateNotFoundError,
  deleteAccessGate,
  getAccessGate,
  updateAccessGate,
} from "@/lib/server/access-gates";
import {
  NO_STORE,
  accessGateErrorResponse,
  readJson,
  rejectCrossOrigin,
} from "@/lib/server/access-gates-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ gateId: string }> };

async function gateId(context: Context): Promise<string> {
  const { gateId: id } = await context.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new AccessGateNotFoundError("門が見つかりません。");
  return id;
}

export async function GET(request: Request, context: Context) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const gate = await getAccessGate(database, await gateId(context));
    if (!gate) throw new AccessGateNotFoundError("門が見つかりません。");
    if (gate.ownerProfileId !== profile.id) throw new AccessGateForbiddenError("この門を閲覧する権限がありません。");
    return NextResponse.json({ gate }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const gate = await updateAccessGate(database, profile.id, await gateId(context), await readJson(request));
    return NextResponse.json({ gate }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    await deleteAccessGate(database, profile.id, await gateId(context));
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}
