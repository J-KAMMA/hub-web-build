import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getCommunityGuidePage, CommunityGuideAccessError } from "@/lib/server/community-guide-access";
import { canProposeCommunityGuide } from "@/lib/server/community-guide-proposals";

export async function GET(request: Request, { params }: { params: Promise<{ communityId: string; pageId: string }> }) {
  const headers = { "cache-control": "private, no-store" };
  try {
    const db=getHubD1(),{communityId,pageId}=await params,viewer=await getOptionalDesktopHubProfile(request,db);
    const data=await getCommunityGuidePage(db,communityId,pageId,viewer);
    return NextResponse.json({...data,canPropose:await canProposeCommunityGuide(db,communityId,viewer)},{headers});
  } catch(error) {
    const status=error instanceof HubSuspendedError?403:error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError?error.status:400;
    return NextResponse.json({error:error instanceof Error?error.message:"ガイドを取得できませんでした。"},{status,headers});
  }
}
