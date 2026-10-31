import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {getCommunityAppeal,resolveCommunityAppeal} from "@/lib/server/community-appeal-review";
import {appealReviewErrorResponse,appealReviewHeaders} from "@/lib/server/community-appeal-review-response";
type Context={params:Promise<{communityId:string;appealId:string}>};
export async function GET(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,appealId}=await params;
    return NextResponse.json(await getCommunityAppeal(db,actor,communityId,appealId),{headers:appealReviewHeaders});
  }catch(error){return appealReviewErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context) {
  try {
    const db=getHubD1(),actor=await requireDesktopHubProfile(request,db),{communityId,appealId}=await params;
    return NextResponse.json(await resolveCommunityAppeal(db,actor,communityId,appealId,await request.json().catch(()=>null)),{headers:appealReviewHeaders});
  }catch(error){return appealReviewErrorResponse(error);}
}
