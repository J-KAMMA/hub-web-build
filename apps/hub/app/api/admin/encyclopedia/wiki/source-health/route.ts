import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin,requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { monitorDueWikiSources } from "@/lib/server/hubpedia-wiki-ai-review";
export async function POST(request:Request){const origin=requireSameOrigin(request);if(origin)return origin;const denied=requireModerationAdmin(request);if(denied)return denied;const body=await request.json().catch(()=>({})) as {limit?:unknown};return NextResponse.json(await monitorDueWikiSources(getHubD1(),fetch,typeof body.limit==="number"?body.limit:25));}
