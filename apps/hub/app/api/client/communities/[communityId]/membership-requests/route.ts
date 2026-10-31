import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {getCommunityMembershipRequests,readMembershipReviewOffset} from "@/lib/server/community-membership-review";
import {membershipReviewErrorResponse,membershipReviewHeaders} from "@/lib/server/community-membership-review-response";
export async function GET(request:Request,{params}:{params:Promise<{communityId:string}>}) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params;
    return NextResponse.json(await getCommunityMembershipRequests(db,actor,communityId,readMembershipReviewOffset(new URL(request.url).searchParams)),{headers:membershipReviewHeaders});
  }catch(error){return membershipReviewErrorResponse(error);}
}
