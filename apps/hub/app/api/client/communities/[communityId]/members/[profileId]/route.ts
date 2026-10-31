import {NextResponse} from "next/server";
import {getHubD1} from "@/lib/server/hub-d1";
import {requireDesktopHubProfile} from "@/lib/server/desktop-hub-auth";
import {manageD1CommunityMember} from "@/lib/server/d1-community-management";
import {memberManagementInput,memberManagementHeaders,memberManagementErrorResponse} from "@/lib/server/community-member-management-response";

export async function PATCH(request:Request,{params}:{params:Promise<{communityId:string;profileId:string}>}) {
  try {
    const database=getHubD1(),actor=await requireDesktopHubProfile(request,database),ids=await params;
    const input=memberManagementInput(await request.json().catch(()=>null));
    return NextResponse.json({member:await manageD1CommunityMember(database,actor,{...ids,...input})},{headers:memberManagementHeaders});
  }catch(error){return memberManagementErrorResponse(error);}
}
