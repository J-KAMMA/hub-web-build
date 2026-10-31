import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubpediaWikiDiff,WikiInputError } from "@/lib/server/hubpedia-wiki";
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){try{const {slug}=await params,url=new URL(request.url),to=url.searchParams.get("to"),from=url.searchParams.get("from");if(!to)return NextResponse.json({error:"to is required."},{status:400});return NextResponse.json(await getHubpediaWikiDiff(getHubD1(),slug,from,to));}catch(e){if(e instanceof WikiInputError)return NextResponse.json({error:e.message},{status:404});throw e;}}
