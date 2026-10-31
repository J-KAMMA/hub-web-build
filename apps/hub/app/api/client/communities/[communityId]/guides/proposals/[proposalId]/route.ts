import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getCommunityGuideProposal } from "@/lib/server/community-guide-proposals";
import { getCommunityGuideReviewData, mutateCommunityGuideProposal } from "@/lib/server/community-guide-review";
import { requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { CommunityGuideProposalError } from "@/lib/server/community-guide-proposals";
import { CommunityGuideAccessError } from "@/lib/server/community-guide-access";
export async function GET(request: Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}) {
  const headers={"cache-control":"private, no-store"};
  try {
    const database=getHubD1(),{communityId,proposalId}=await params,viewer=await getOptionalDesktopHubProfile(request,database);
    const data=await getCommunityGuideProposal(database,communityId,proposalId,viewer);
    return NextResponse.json({...data,...await getCommunityGuideReviewData(database,communityId,proposalId,viewer)},{headers});
  } catch(error) {
    const status=error instanceof HubSuspendedError?403:error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError?error.status:400;
    return NextResponse.json({error:error instanceof Error?error.message:"編集案を取得できませんでした。"},{status,headers});
  }
}

export async function PATCH(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){
  const headers={"cache-control":"private, no-store"};
  try{
    const database=getHubD1(),{communityId,proposalId}=await params,actor=await requireDesktopHubProfile(request,database);
    return NextResponse.json(await mutateCommunityGuideProposal(database,actor,communityId,proposalId,await request.json()),{headers});
  }catch(error){
    const status=error instanceof HubSuspendedError?403:error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError||error instanceof CommunityGuideProposalError?error.status:400;
    return NextResponse.json({error:error instanceof Error?error.message:"編集案を更新できませんでした。"},{status,headers});
  }
}
