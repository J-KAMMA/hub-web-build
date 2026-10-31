import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { recordArticleView,WikiInputError } from "@/lib/server/hubpedia-wiki";
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}){const origin=requireSameOrigin(request);if(origin)return origin;try{const {slug}=await params;return NextResponse.json(await recordArticleView(getHubD1(),slug));}catch(error){if(error instanceof WikiInputError)return NextResponse.json({error:error.message},{status:400});throw error;}}
