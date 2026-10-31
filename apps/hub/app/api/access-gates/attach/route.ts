import { NextResponse } from "next/server";

import {
  AccessGateForbiddenError,
  AccessGateValidationError,
  attachAccessGate,
  canManageGatedTarget,
  detachAccessGate,
  getContentAccessGate,
  parseAccessGateTarget,
} from "@/lib/server/access-gates";
import {
  NO_STORE,
  accessGateErrorResponse,
  readJson,
  rejectCrossOrigin,
} from "@/lib/server/access-gates-route";
import { onAccessGateAttached, onAccessGateDetached } from "@/lib/server/gated-exits";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

function body(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AccessGateValidationError("リクエストの形式が正しくありません。");
  }
  return value as Record<string, unknown>;
}

/** Current gate id of a target: ?targetType=&targetId=. Only the content's manager may read it. */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const params = new URL(request.url).searchParams;
    const target = parseAccessGateTarget(params.get("targetType"), params.get("targetId"));
    if (!(await canManageGatedTarget(database, profile.id, target))) {
      throw new AccessGateForbiddenError("このコンテンツの閲覧条件を確認する権限がありません。");
    }
    const gate = await getContentAccessGate(database, target);
    return NextResponse.json({ gateId: gate?.id ?? null }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}

/** Attach a gate: { targetType, targetId, gateId }. Only the content's author (or channel manager) may attach. */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = body(await readJson(request));
    if (typeof input.gateId !== "string") throw new AccessGateValidationError("gateIdが必要です。");
    const attached = await attachAccessGate(database, profile.id, input as { targetType: unknown; targetId: unknown }, input.gateId);
    await onAccessGateAttached(database, attached); // public -> gated: federation Delete
    return NextResponse.json({ attached }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}

/** Detach: { targetType, targetId }. */
export async function DELETE(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const detachTarget = body(await readJson(request)) as { targetType: unknown; targetId: unknown };
    await detachAccessGate(database, profile.id, detachTarget);
    await onAccessGateDetached(database, { targetType: String(detachTarget.targetType), targetId: String(detachTarget.targetId) }); // gated -> public: federation Create
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}
