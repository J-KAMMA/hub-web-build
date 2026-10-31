import { NextResponse } from "next/server";

import { getCodeRepository } from "@/lib/server/code-repositories";
import { NO_STORE, codeErrorResponse, rejectCodeRequest } from "@/lib/server/code-repositories-env";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/** One repository's metadata: public to everyone, private only to the owner and collaborators. */
export async function GET(request: Request, context: { params: Promise<{ owner: string; name: string }> }) {
  const rejected = rejectCodeRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    const { owner, name } = await context.params;
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    const repository = await getCodeRepository(database, viewer?.id ?? null, owner, name);
    if (!repository) {
      return NextResponse.json({ error: "リポジトリが見つかりません。", code: "not_found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ repository }, { headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
