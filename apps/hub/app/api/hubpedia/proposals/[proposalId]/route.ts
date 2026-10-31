import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError,requireHubSessionProfile } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { WikiConflictError,withdrawProposal } from "@/lib/server/hubpedia-wiki";

export async function DELETE(request:Request,{params}:{params:Promise<{proposalId:string}>}){
  const origin=requireSameOrigin(request);if(origin)return origin;
  try{const db=getHubD1(),actor=await requireHubSessionProfile(request,db),{proposalId}=await params;return NextResponse.json(await withdrawProposal(db,actor,proposalId));}
  catch(error){if(error instanceof HubAuthenticationError)return NextResponse.json({error:"ログインが必要です。"},{status:401});if(error instanceof WikiConflictError)return NextResponse.json({error:error.message},{status:409});throw error;}
}
