import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {getOwnCommunityAppeals,submitCommunityAppeal} from "@/lib/server/community-appeal-submission";
import {appealReviewErrorResponse,appealReviewHeaders} from "@/lib/server/community-appeal-review-response";
type Context={params:Promise<{communityId:string}>};
export async function GET(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params;
    return NextResponse.json(await getOwnCommunityAppeals(db,actor,communityId),{headers:appealReviewHeaders});
  }catch(error){return appealReviewErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId}=await params;
    return NextResponse.json(await submitCommunityAppeal(db,actor,communityId,await request.json().catch(()=>null)),{status:201,headers:appealReviewHeaders});
  }catch(error){return appealReviewErrorResponse(error);}
}
