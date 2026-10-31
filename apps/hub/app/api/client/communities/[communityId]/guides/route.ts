import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalDesktopHubProfile, requireDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getCommunityGuideCatalog, readCommunityGuideOffset, readCommunityGuideDirectory, CommunityGuideAccessError } from "@/lib/server/community-guide-access";
import { canProposeCommunityGuide, createCommunityGuideProposal, CommunityGuideProposalError } from "@/lib/server/community-guide-proposals";

export async function GET(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const headers = { "cache-control": "private, no-store" };
  try {
    const db = getHubD1(), { communityId } = await params, viewer = await getOptionalDesktopHubProfile(request, db);
    const query=new URL(request.url).searchParams;
    const data=await getCommunityGuideCatalog(db,communityId,viewer,readCommunityGuideOffset(query),readCommunityGuideDirectory(query));
    return NextResponse.json({...data,canPropose:await canProposeCommunityGuide(db,communityId,viewer)}, { headers });
  } catch (error) {
    const status = error instanceof HubSuspendedError ? 403 : error instanceof DesktopHubAuthenticationError ? 401
      : error instanceof HubD1UnavailableError ? 503 : error instanceof CommunityGuideAccessError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ガイドを取得できませんでした。" }, { status, headers });
  }
}

export async function POST(request: Request, {params}: {params: Promise<{communityId: string}>}) {
  const headers={"cache-control":"private, no-store"};
  try {
    const database=getHubD1(),{communityId}=await params,actor=await requireDesktopHubProfile(request,database);
    const result=await createCommunityGuideProposal(database,actor,communityId,await request.json());
    return NextResponse.json(result,{status:result.replayed?200:201,headers});
  } catch(error) {
    const status=error instanceof HubSuspendedError?403:error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError || error instanceof CommunityGuideProposalError?error.status:400;
    return NextResponse.json({error:error instanceof Error?error.message:"編集案を保存できませんでした。"},{status,headers});
  }
}
