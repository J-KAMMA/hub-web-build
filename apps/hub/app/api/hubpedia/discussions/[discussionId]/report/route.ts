import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError,requireHubSessionProfile } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { reportDiscussion,WikiInputError } from "@/lib/server/hubpedia-wiki";
export async function POST(request:Request,{params}:{params:Promise<{discussionId:string}>}){const origin=requireSameOrigin(request);if(origin)return origin;try{const db=getHubD1(),actor=await requireHubSessionProfile(request,db),body=await request.json() as {reason?:unknown},{discussionId}=await params;return NextResponse.json(await reportDiscussion(db,actor,discussionId,body.reason));}catch(error){if(error instanceof HubAuthenticationError)return NextResponse.json({error:"ログインが必要です。"},{status:401});if(error instanceof WikiInputError)return NextResponse.json({error:error.message},{status:400});throw error;}}
