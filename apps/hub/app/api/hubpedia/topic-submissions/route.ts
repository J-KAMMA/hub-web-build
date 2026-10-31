import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  TopicSubmissionDuplicateError,
  TopicSubmissionInputError,
  TopicSubmissionRateLimitError,
  submitHubpediaTopic,
} from "@/lib/server/hubpedia-topic-submissions";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

/*
 * Readers propose a subject and candidate sources. Direct editing stays
 * closed: this accepts a proposal, and the factory's gates decide the rest.
 */
export async function POST(request: Request) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  try {
    const db = getHubD1();
    const actor = await requireHubSessionProfile(request, db);
    const input = await request.json().catch(() => null) as unknown;
    if (!input) return NextResponse.json({ error: "入力を確認してください。" }, { status: 400 });
    return NextResponse.json(await submitHubpediaTopic(db, actor, input), { status: 202 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof TopicSubmissionRateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof TopicSubmissionDuplicateError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof TopicSubmissionInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
