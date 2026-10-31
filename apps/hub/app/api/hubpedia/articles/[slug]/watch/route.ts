import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile,HubAuthenticationError } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { getWatch,setWatch } from "@/lib/server/hubpedia-wiki";
async function actor(request:Request){const db=getHubD1();return {db,profile:await requireHubSessionProfile(request,db)};}
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){try{const {db,profile}=await actor(request),{slug}=await params;return NextResponse.json({watching:await getWatch(db,profile,slug)});}catch(e){if(e instanceof HubAuthenticationError)return NextResponse.json({error:"ログインが必要です。"},{status:401});throw e;}}
export async function PUT(request:Request,ctx:{params:Promise<{slug:string}>}){const origin=requireSameOrigin(request);if(origin)return origin;try{const {db,profile}=await actor(request),{slug}=await ctx.params;return NextResponse.json(await setWatch(db,profile,slug,true));}catch(e){if(e instanceof HubAuthenticationError)return NextResponse.json({error:"ログインが必要です。"},{status:401});throw e;}}
export async function DELETE(request:Request,ctx:{params:Promise<{slug:string}>}){const origin=requireSameOrigin(request);if(origin)return origin;try{const {db,profile}=await actor(request),{slug}=await ctx.params;return NextResponse.json(await setWatch(db,profile,slug,false));}catch(e){if(e instanceof HubAuthenticationError)return NextResponse.json({error:"ログインが必要です。"},{status:401});throw e;}}
