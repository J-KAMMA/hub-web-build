import { NextResponse } from "next/server";

import { consumeGateCheckQuota } from "@/lib/server/access-gate-check-rate";
import { AccessGateValidationError, parseAccessGateTarget } from "@/lib/server/access-gates";
import {
  NO_STORE,
  accessGateErrorResponse,
  readJson,
  rejectCrossOrigin,
} from "@/lib/server/access-gates-route";
import { checkTargetGateStatus } from "@/lib/server/gated-content";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/** "Check again": ignores the cached result and returns only the outcome, never addresses or balances. */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const body = await readJson(request);
    if (typeof body !== "object" || body === null) throw new AccessGateValidationError("リクエストが正しくありません。");
    const { targetType, targetId } = body as Record<string, unknown>;
    const target = parseAccessGateTarget(targetType, targetId);
    if (!(await consumeGateCheckQuota(database, profile.id))) {
      return NextResponse.json({ error: "確認の回数が上限に達しました。しばらくしてからお試しください。" }, {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": "3600" },
      });
    }
    const status = await checkTargetGateStatus(database, profile.id, target);
    const outcome = status === "open" ? "allowed" : status === "locked" ? "denied" : "unavailable";
    return NextResponse.json({ status, outcome }, { headers: NO_STORE });
  } catch (error) {
    return accessGateErrorResponse(error);
  }
}
