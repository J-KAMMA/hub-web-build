import { NextResponse } from "next/server";

import { authorizeCodeGit } from "@/lib/server/code-repositories";
import { NO_STORE, codeErrorResponse, hubCodeDepsFromEnv, rejectCodeServiceRequest } from "@/lib/server/code-repositories-env";
import { getHubD1 } from "@/lib/server/hub-d1";

export const dynamic = "force-dynamic";

/**
 * Called only by the Code Worker: { owner, name, access, phase, tokenHash }. Answers with a signed
 * `jkamma-code` ticket or a refusal status. The token itself never reaches Hub.
 */
export async function POST(request: Request) {
  const rejected = rejectCodeServiceRequest(request);
  if (rejected) return rejected;
  try {
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== "object") return NextResponse.json({ code: "not_found" }, { status: 404, headers: NO_STORE });
    const result = await authorizeCodeGit(getHubD1(), hubCodeDepsFromEnv(), {
      owner: input.owner,
      name: input.name,
      access: input.access,
      phase: input.phase,
      tokenHash: input.tokenHash ?? null,
    });
    if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.status, headers: NO_STORE });
    return NextResponse.json({ ticket: result.ticket }, { headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
