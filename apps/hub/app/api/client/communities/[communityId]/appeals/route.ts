import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {getCommunityAppeals,readCommunityAppealOffset} from "@/lib/server/community-appeal-review";
import {appealReviewErrorResponse,appealReviewHeaders} from "@/lib/server/community-appeal-review-response";
export async function GET(request:Request,{params}:{params:Promise<{communityId:string}>}) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params;
    return NextResponse.json(await getCommunityAppeals(db,actor,communityId,readCommunityAppealOffset(new URL(request.url).searchParams)),{headers:appealReviewHeaders});
  }catch(error){return appealReviewErrorResponse(error);}
}
