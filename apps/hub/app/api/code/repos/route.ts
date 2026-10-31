import { NextResponse } from "next/server";

import { createCodeRepository, listOwnCodeRepositories, listPublicCodeRepositoriesByOwner } from "@/lib/server/code-repositories";
import { NO_STORE, codeErrorResponse, hubCodeDepsFromEnv, rejectCodeRequest } from "@/lib/server/code-repositories-env";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { encodeWorkCursor, findListableAuthorId, PROFILE_WORKS_PAGE, readAuthorListQuery } from "@/lib/server/profile-works";

export const dynamic = "force-dynamic";

/** Create a repository: { name, description?, visibility?: "public" | "private" }. */
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
    const repository = await createCodeRepository(database, hubCodeDepsFromEnv(), profile.id, input);
    return NextResponse.json({ repository }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}

/**
 * Repositories the signed-in profile owns or collaborates on. With ?owner=<handle> (and an
 * optional cursor) it is instead that owner's public repositories, readable without signing in.
 */
export async function GET(request: Request) {
  const rejected = rejectCodeRequest(request, { write: false });
  if (rejected) return rejected;
  try {
    const database = getHubD1();
    const url = new URL(request.url);
    if (url.searchParams.has("owner")) {
      const query = readAuthorListQuery(url, "owner");
      if (!query) return NextResponse.json({ error: "リクエストが正しくありません。", code: "invalid_input" }, { status: 400, headers: NO_STORE });
      const ownerId = await findListableAuthorId(database, query.handle);
      if (!ownerId) return NextResponse.json({ error: "見つかりません。", code: "not_found" }, { status: 404, headers: NO_STORE });
      const page = await listPublicCodeRepositoriesByOwner(database, ownerId, { limit: PROFILE_WORKS_PAGE, before: query.cursor });
      return NextResponse.json(
        { repositories: page.repositories, nextCursor: page.nextCursor ? encodeWorkCursor(page.nextCursor) : null },
        { headers: NO_STORE },
      );
    }
    const profile = await requireHubSessionProfile(request, database);
    return NextResponse.json({ repositories: await listOwnCodeRepositories(database, profile.id) }, { headers: NO_STORE });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
