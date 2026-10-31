import { NextResponse } from "next/server";

import { revokeCodeToken } from "@/lib/server/code-repositories";
import { NO_STORE, codeErrorResponse, rejectCodeRequest } from "@/lib/server/code-repositories-env";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/** Revoke one of the signed-in profile's Git tokens. */
export async function DELETE(request: Request, context: { params: Promise<{ tokenId: string }> }) {
  const rejected = rejectCodeRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const { tokenId } = await context.params;
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    if (!(await revokeCodeToken(database, {}, profile.id, tokenId))) {
      return NextResponse.json({ error: "トークンが見つかりません。", code: "not_found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ revoked: true }, { headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
