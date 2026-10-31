import {NextResponse} from "next/server";
import {hasSameOrigin} from "@/lib/server/hub-auth-route";
import {reviewCommunityGuideProposalRouteData} from "@/lib/server/community-route-data";
import {HubAuthenticationError,HubSuspendedError} from "@/lib/server/hub-session";
import {HubD1UnavailableError} from "@/lib/server/hub-d1";
import {CommunityGuideAccessError} from "@/lib/server/community-guide-access";
import {CommunityGuideProposalError} from "@/lib/server/community-guide-proposals";
export async function POST(request:Request,{params}:{params:Promise<{communityId:string;proposalId:string}>}){
 const headers={"cache-control":"private, no-store"};
 if(!hasSameOrigin(request))return NextResponse.json({error:"invalid_origin"},{status:403,headers});
 try{
  const {communityId,proposalId}=await params,body:unknown=await request.json();
  if(!body||typeof body!=="object"||Array.isArray(body))throw new CommunityGuideProposalError("操作内容を確認してください。",400);
  const input=body as Record<string,unknown>;
  const result=await reviewCommunityGuideProposalRouteData(request,{communityId,proposalId,body: input.body, decision: input.decision, requestId:input.requestId,expectedUpdatedAt:input.expectedUpdatedAt});
  return NextResponse.json(result,{status:result.replayed?200:201,headers});
 }catch(error){
  const status=error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:error instanceof HubD1UnavailableError?503:error instanceof CommunityGuideAccessError||error instanceof CommunityGuideProposalError?error.status:400;
  return NextResponse.json({error:error instanceof Error?error.message:"編集案を処理できませんでした。"},{status,headers});
 }
}
