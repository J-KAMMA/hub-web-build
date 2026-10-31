import { NextResponse } from "next/server";

import type { ThreadPostReport } from "@/lib/domain";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";
import { listModerationReportsRouteData } from "@/lib/server/moderation-admin-route-data";

const STATUSES = ["open", "resolved", "dismissed", "all"] as const;

export async function GET(request: Request) {
  const authError = requireModerationAdmin(request);
  if (authError) return authError;
  const requested = new URL(request.url).searchParams.get("status") ?? "open";
  const status = STATUSES.includes(requested as typeof STATUSES[number])
    ? requested as ThreadPostReport["status"] | "all"
    : "open";
  try {
    return NextResponse.json(await listModerationReportsRouteData(status), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "通報一覧を取得できませんでした。" }, { status: 500 });
  }
}
