import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {getCommunityReports,readCommunityReportOffset} from "@/lib/server/community-report-review";
import {reportReviewErrorResponse,reportReviewHeaders} from "@/lib/server/community-report-review-response";
export async function GET(request:Request,{params}:{params:Promise<{communityId:string}>}) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params;
    return NextResponse.json(await getCommunityReports(db,actor,communityId,readCommunityReportOffset(new URL(request.url).searchParams)),{headers:reportReviewHeaders});
  }catch(error){return reportReviewErrorResponse(error);}
}
