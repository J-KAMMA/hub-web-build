import {NextResponse} from "next/server";
import {hasSameOrigin} from "@/lib/server/hub-auth-route";
import {getHubD1} from "@/lib/server/hub-d1";
import {getOptionalHubSessionProfile,HubAuthenticationError,requireHubSessionProfile} from "@/lib/server/hub-session";
import {createD1WorkListing,listD1WorkListings} from "@/lib/server/d1-work-listings";
import {parseWorkListingInput} from "@/lib/work-listings";
const jsonError=(error:string,status:number)=>NextResponse.json({error},{status});
export async function GET(request:Request){const db=getHubD1(),viewer=await getOptionalHubSessionProfile(request,db);return NextResponse.json({listings:await listD1WorkListings(db,viewer?.id)},{headers:{"Cache-Control":"no-store"}});}
export async function POST(request:Request){if(!hasSameOrigin(request))return jsonError("不正なリクエストです。",403);try{const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),body=await request.json().catch(()=>null) as Record<string,unknown>|null,input=body&&parseWorkListingInput(body);if(!input)return jsonError("入力内容を確認してください。",400);return NextResponse.json({listing:await createD1WorkListing(db,viewer,input)},{status:201});}catch(error){if(error instanceof HubAuthenticationError)return jsonError("ログインが必要です。",401);return jsonError("掲載を保存できませんでした。",500);}}
