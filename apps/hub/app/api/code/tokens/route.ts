import { NextResponse } from "next/server";

import { issueCodeToken, listCodeTokens } from "@/lib/server/code-repositories";
import { NO_STORE, codeErrorResponse, rejectCodeRequest } from "@/lib/server/code-repositories-env";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export const dynamic = "force-dynamic";

/**
 * Issue a Git access token: { scope: "read" | "write", repoId?: string | null, expiresInDays?: 1-90,
 * label? }. The plaintext is in this response only; Hub keeps its SHA-256 hash.
 */
export async function POST(request: Request) {
  const rejected = rejectCodeRequest(request, { write: true });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== "object") {
      return NextResponse.json({ error: "リクエストが正しくありません。", code: "invalid_input" }, { status: 400, headers: NO_STORE });
    }
    const { token, view } = await issueCodeToken(database, {}, profile.id, input);
    return NextResponse.json({ token, tokenInfo: view }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}

export async function GET(request: Request) {
  const rejected = rejectCodeRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json({ tokens: await listCodeTokens(database, profile.id) }, { headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
