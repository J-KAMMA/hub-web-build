import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {getCommunityReport,resolveCommunityReport} from "@/lib/server/community-report-review";
import {reportReviewErrorResponse,reportReviewHeaders} from "@/lib/server/community-report-review-response";
type Context={params:Promise<{communityId:string;reportId:string}>};
export async function GET(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,reportId}=await params;
    return NextResponse.json(await getCommunityReport(db,actor,communityId,reportId),{headers:reportReviewHeaders});
  }catch(error){return reportReviewErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,reportId}=await params;
    return NextResponse.json(await resolveCommunityReport(db,actor,communityId,reportId,await request.json().catch(()=>null)),{headers:reportReviewHeaders});
  }catch(error){return reportReviewErrorResponse(error);}
}
