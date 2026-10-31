import { NextResponse } from "next/server";

import { settleCodePush } from "@/lib/server/code-repositories";
import { NO_STORE, codeErrorResponse, hubCodeDepsFromEnv, rejectCodeServiceRequest } from "@/lib/server/code-repositories-env";
import { getHubD1 } from "@/lib/server/hub-d1";

export const dynamic = "force-dynamic";

/** Called only by the Code Worker after a receive-pack request: { ticket, bytes, ok }. */
export async function POST(request: Request) {
  const rejected = rejectCodeServiceRequest(request);
  if (rejected) return rejected;
  try {
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== "object") {
      return NextResponse.json({ code: "invalid_report" }, { status: 400, headers: NO_STORE });
    }
    const result = await settleCodePush(getHubD1(), hubCodeDepsFromEnv(), { ticket: input.ticket, bytes: input.bytes, ok: input.ok });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
