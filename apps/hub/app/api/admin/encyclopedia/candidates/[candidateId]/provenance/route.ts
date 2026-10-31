import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  acceptHubpediaCandidateProvenance,
  HubpediaKnowledgeCycleInputError,
} from "@/lib/server/hubpedia-knowledge-cycle";
import {
  requireModerationAdmin,
  requireSameOrigin,
} from "@/lib/server/moderation-admin-auth";
import { resolveMcpArticle } from "@/lib/server/hubpedia-mcp-data";

export async function POST(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => null) as {
    articleSlug?: unknown;
  } | null;
  const articleSlug = typeof body?.articleSlug === "string"
    ? body.articleSlug
    : "";
  try {
    const db = getHubD1();
    if (!await resolveMcpArticle(db, articleSlug, "ja")) {
      return NextResponse.json({ error: "article_not_found" }, { status: 404 });
    }
    const { candidateId } = await context.params;
    return NextResponse.json({
      provenance: await acceptHubpediaCandidateProvenance(db, {
        candidateId,
        articleSlug,
      }),
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HubpediaKnowledgeCycleInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
