import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getCommunityGuideRevision, CommunityGuideAccessError } from "@/lib/server/community-guide-access";

export async function GET(request: Request, { params }: { params: Promise<{ communityId: string; pageId: string; revisionId: string }> }) {
  const headers={"cache-control":"private, no-store"};
  try {
    const db=getHubD1(),{communityId,pageId,revisionId}=await params,viewer=await getOptionalDesktopHubProfile(request,db);
    return NextResponse.json(await getCommunityGuideRevision(db,communityId,pageId,revisionId,viewer),{headers});
  } catch(error) {
    const status=error instanceof HubSuspendedError?403:error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError?error.status:400;
    return NextResponse.json({error:error instanceof Error?error.message:"改訂を取得できませんでした。"},{status,headers});
  }
}
