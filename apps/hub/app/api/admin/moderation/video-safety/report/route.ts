import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { resolveVideoReport, type ReportResolution } from "@/lib/server/hub-video-review";
import { HubVideoError } from "@/lib/server/hub-videos";
import { hubVideoDepsFromEnv } from "@/lib/server/hub-videos-env";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
const RESOLUTIONS: readonly ReportResolution[] = ["dismiss", "remove", "age_restrict"];

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) || requireSameOrigin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) denied.headers.set(name, value);
    return denied;
  }
  const body = await request.json().catch(() => null) as { reportId?: unknown; resolution?: unknown } | null;
  if (!body || typeof body.reportId !== "string" || !RESOLUTIONS.includes(body.resolution as ReportResolution)) {
    return json({ error: "invalid_input" }, 400);
  }
  try {
    await resolveVideoReport(getHubD1(), hubVideoDepsFromEnv(), body.reportId, body.resolution as ReportResolution);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof HubVideoError) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "unavailable" }, 503);
  }
}
