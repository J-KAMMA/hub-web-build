import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getCommunityGuideProposals } from "@/lib/server/community-guide-proposals";
import { readCommunityGuideOffset, CommunityGuideAccessError } from "@/lib/server/community-guide-access";
export async function GET(request: Request,{params}:{params:Promise<{communityId:string}>}) {
  const headers={"cache-control":"private, no-store"};
  try {
    const database=getHubD1(),{communityId}=await params,viewer=await getOptionalDesktopHubProfile(request,database);
    return NextResponse.json(await getCommunityGuideProposals(database,communityId,viewer,readCommunityGuideOffset(new URL(request.url).searchParams)),{headers});
  } catch(error) {
    const status=error instanceof HubSuspendedError?403:error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError?error.status:400;
    return NextResponse.json({error:error instanceof Error?error.message:"編集案を取得できませんでした。"},{status,headers});
  }
}
