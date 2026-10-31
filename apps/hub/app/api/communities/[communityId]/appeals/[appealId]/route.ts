import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireHubSessionProfile} from "@/lib/server/hub-session";
import {getCommunityAppeal} from "@/lib/server/community-appeal-review";
import {appealReviewErrorResponse,appealReviewHeaders} from "@/lib/server/community-appeal-review-response";
export async function GET(request:Request,{params}:{params:Promise<{communityId:string;appealId:string}>}) {
  try {
    const db=getHubD1(),actor=await requireHubSessionProfile(request,db),{communityId,appealId}=await params;
    return NextResponse.json(await getCommunityAppeal(db,actor,communityId,appealId),{headers:appealReviewHeaders});
  }catch(error){return appealReviewErrorResponse(error);}
}
