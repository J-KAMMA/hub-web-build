import { NextRequest, NextResponse } from "next/server";

import {
  listD1MentionSuggestions,
  normalizeMentionSuggestionQuery,
  type MentionSuggestion,
} from "@/lib/server/d1-mention-suggestions";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

export async function GET(request: NextRequest) {
  const query = normalizeMentionSuggestionQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (!query) {
    return NextResponse.json(
      { suggestions: [] },
      { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } },
    );
  }
  let suggestions: MentionSuggestion[];
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    suggestions = await listD1MentionSuggestions(
      database,
      query,
      viewer?.id ?? null,
    );
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "mention_suggestions_unavailable", suggestions: [] },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store",
            "Vary": "Cookie",
          },
        },
      );
    }
    throw error;
  }

  return NextResponse.json(
    { suggestions },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Vary": "Cookie",
      },
    },
  );
}
