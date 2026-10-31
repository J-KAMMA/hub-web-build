import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireHubSessionProfile} from "@/lib/server/hub-session";
import {requireSameOrigin} from "@/lib/server/moderation-admin-auth";
import {manageD1CommunityMember} from "@/lib/server/d1-community-management";
import {memberManagementInput,memberManagementHeaders,memberManagementErrorResponse} from "@/lib/server/community-member-management-response";

export async function PATCH(request:Request,{params}:{params:Promise<{communityId:string;profileId:string}>}) {
  const denied=requireSameOrigin(request);
  if(denied){denied.headers.set("cache-control","private, no-store");return denied;}
  try {
    const input=memberManagementInput(await request.json().catch(()=>null));
    const database=getHubD1(),actor=await requireHubSessionProfile(request,database),ids=await params;
    return NextResponse.json({member:await manageD1CommunityMember(database,actor,{...ids,...input})},{headers:memberManagementHeaders});
  }catch(error){return memberManagementErrorResponse(error);}
}
