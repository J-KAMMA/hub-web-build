import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {getCommunityMembershipRequest,reviewCommunityMembershipRequest} from "@/lib/server/community-membership-review";
import {membershipReviewErrorResponse,membershipReviewHeaders} from "@/lib/server/community-membership-review-response";
type Context={params:Promise<{communityId:string;profileId:string}>};
export async function GET(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,profileId}=await params;
    return NextResponse.json(await getCommunityMembershipRequest(db,actor,communityId,profileId),{headers:membershipReviewHeaders});
  }catch(error){return membershipReviewErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,profileId}=await params;
    const payload=await request.json().catch(()=>null);
    return NextResponse.json(await reviewCommunityMembershipRequest(db,actor,communityId,profileId,payload),{headers:membershipReviewHeaders});
  }catch(error){return membershipReviewErrorResponse(error);}
}
