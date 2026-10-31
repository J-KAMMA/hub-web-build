import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile, HubSuspendedError } from "@/lib/server/hub-session";
import { getCommunityGuideRevisions, CommunityGuideAccessError } from "@/lib/server/community-guide-access";

export async function GET(request: Request, { params }: { params: Promise<{ communityId: string; pageId: string }> }) {
  const { communityId, pageId } = await params;
  const headers = { "cache-control": "private, no-store" };
  try {
    const database=getHubD1(),viewer=await getOptionalHubSessionProfile(request,database);
    return NextResponse.json(await getCommunityGuideRevisions(database,communityId,pageId,viewer), { headers });
  } catch (error) {
    const status=error instanceof HubSuspendedError?403:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError?error.status:400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "改訂履歴を取得できませんでした。" }, { status, headers });
  }
}
