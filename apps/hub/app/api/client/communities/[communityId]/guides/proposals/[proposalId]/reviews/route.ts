import {NextResponse} from "next/server";
import {getHubD1,HubD1UnavailableError} from "@/lib/server/hub-d1";
import {getOptionalDesktopHubProfile,requireDesktopHubProfile,DesktopHubAuthenticationError} from "@/lib/server/desktop-hub-auth";
import {HubSuspendedError} from "@/lib/server/hub-session";
import {CommunityGuideAccessError,readCommunityGuideOffset} from "@/lib/server/community-guide-access";
import {CommunityGuideProposalError} from "@/lib/server/community-guide-proposals";
import {getCommunityGuideReviewData,mutateCommunityGuideProposal} from "@/lib/server/community-guide-review";
type Context={params:Promise<{communityId:string;proposalId:string}>};
const headers={"cache-control":"private, no-store"};
function failure(error:unknown){
 const status=error instanceof HubSuspendedError?403:error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError||error instanceof CommunityGuideProposalError?error.status:400;
 return NextResponse.json({error:error instanceof Error?error.message:"レビューを処理できませんでした。"},{status,headers});
}
export async function GET(request:Request,{params}:Context){
 try{const database=getHubD1(),{communityId,proposalId}=await params,viewer=await getOptionalDesktopHubProfile(request,database);
  return NextResponse.json(await getCommunityGuideReviewData(database,communityId,proposalId,viewer,readCommunityGuideOffset(new URL(request.url).searchParams)),{headers});
 }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){
 try{const database=getHubD1(),{communityId,proposalId}=await params,actor=await requireDesktopHubProfile(request,database);
  const result=await mutateCommunityGuideProposal(database,actor,communityId,proposalId,await request.json(),true);
  return NextResponse.json(result,{status:result.replayed?200:201,headers});
 }catch(error){return failure(error);}
}
