import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile,HubAuthenticationError } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { WikiSuspendedError } from "@/lib/server/hubpedia-wiki-policy";
import { listDiscussion,postDiscussion,WikiInputError,WikiRateLimitError } from "@/lib/server/hubpedia-wiki";
export async function GET(_:Request,{params}:{params:Promise<{slug:string}>}){const {slug}=await params;return NextResponse.json({comments:await listDiscussion(getHubD1(),slug)});}
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}){const origin=requireSameOrigin(request);if(origin)return origin;try{const db=getHubD1(),actor=await requireHubSessionProfile(request,db),body=await request.json() as {body?:unknown,parentId?:unknown},{slug}=await params;return NextResponse.json(await postDiscussion(db,actor,slug,body.body,body.parentId),{status:201});}catch(e){if(e instanceof HubAuthenticationError)return NextResponse.json({error:"ログインが必要です。"},{status:401});if(e instanceof WikiSuspendedError)return NextResponse.json({error:e.message,code:"editor_suspended",expiresAt:e.expiresAt},{status:403});if(e instanceof WikiRateLimitError)return NextResponse.json({error:e.message},{status:429});if(e instanceof WikiInputError)return NextResponse.json({error:e.message},{status:400});throw e;}}
