import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HubpediaKnowledgeCycleInputError,
  linkHubpediaArticleDiscussion,
  listHubpediaArticleDiscussions,
} from "@/lib/server/hubpedia-knowledge-cycle";
import {
  HubAuthenticationError,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";
import { resolveMcpArticle } from "@/lib/server/hubpedia-mcp-data";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  try {
    return NextResponse.json(
      await listHubpediaArticleDiscussions(getHubD1(), slug),
      { headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof HubpediaKnowledgeCycleInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as {
    threadId?: unknown;
  } | null;
  const { slug } = await context.params;
  try {
    const db = getHubD1();
    const actor = await requireHubSessionProfile(request, db);
    if (!await resolveMcpArticle(db, slug, "ja")) {
      return NextResponse.json({ error: "article_not_found" }, { status: 404 });
    }
    return NextResponse.json(
      await linkHubpediaArticleDiscussion(db, actor, slug, body?.threadId),
      { status: 201, headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json(
        { error: "authentication_required" },
        { status: 401 },
      );
    }
    if (error instanceof HubpediaKnowledgeCycleInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
