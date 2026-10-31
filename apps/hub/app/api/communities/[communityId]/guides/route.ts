import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, HubSuspendedError, HubAuthenticationError } from "@/lib/server/hub-session";
import { CommunityGuideAccessError } from "@/lib/server/community-guide-access";
import { CommunityGuideProposalError } from "@/lib/server/community-guide-proposals";

import {
  createCommunityGuideProposalRouteData,
  getCommunityGuidesRouteData,
} from "@/lib/server/community-route-data";

export async function GET(
  request: Request,
  context: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await context.params;
  const headers = { "cache-control": "private, no-store" };
  try {
    const database = getHubD1(), viewer = await getOptionalHubSessionProfile(request,database);
    return NextResponse.json(await getCommunityGuidesRouteData(communityId,viewer,database), { headers });
  } catch (error) {
    const status = error instanceof HubSuspendedError ? 403 : error instanceof HubD1UnavailableError ? 503 : error instanceof CommunityGuideAccessError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ガイドを取得できませんでした。" }, { status, headers });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ communityId: string }> },
) {
  const headers = { "cache-control": "private, no-store" };
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403, headers });
  const { communityId } = await context.params;
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return NextResponse.json({ error: "編集提案の入力内容を確認してください。" }, { status: 400, headers });
  const body = payload as {
    pageId?: unknown;
    proposedDirectoryId?: unknown;
    title?: unknown;
    proposedTitle?: unknown;
    proposedBody?: unknown;
    summary?: unknown;
    requestId?: unknown;
    baseVersion?: unknown;
  };
  if (
    (body.pageId !== undefined &&
      body.pageId !== null &&
      typeof body.pageId !== "string") ||
    (body.proposedDirectoryId !== undefined &&
      body.proposedDirectoryId !== null &&
      typeof body.proposedDirectoryId !== "string") ||
    typeof body.title !== "string" ||
    typeof body.proposedTitle !== "string" ||
    typeof body.proposedBody !== "string" ||
    typeof body.summary !== "string" ||
    (body.requestId !== undefined && typeof body.requestId !== "string") ||
    (body.baseVersion !== undefined && typeof body.baseVersion !== "number")
  )
    return NextResponse.json(
      { error: "編集提案の入力内容を確認してください。" },
      { status: 400, headers },
    );
  try {
    const result = await createCommunityGuideProposalRouteData(request, {
        communityId,
        pageId: body.pageId as string | null | undefined,
        proposedDirectoryId: body.proposedDirectoryId as
          string | null | undefined,
        title: body.title,
        proposedTitle: body.proposedTitle,
        proposedBody: body.proposedBody,
        summary: body.summary,
        requestId: body.requestId as string | undefined,
        baseVersion: body.baseVersion as number | undefined,
      });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) {
    const status=error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError || error instanceof CommunityGuideProposalError?error.status:400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "編集提案を作成できませんでした。",
      },
      { status, headers },
    );
  }
}
