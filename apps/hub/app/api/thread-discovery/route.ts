import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { listD1ThreadDiscoveryPage } from "@/lib/server/d1-threads";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const after = params.get("after");
  if (after !== null && (!after || after.length > 200)) return NextResponse.json({error:"Invalid cursor"},{status:400});
  const board = (params.get("board") ?? "").trim().slice(0,60);
  const tag = (params.get("tag") ?? "").trim().slice(0,40);
  try {
    const page = await listD1ThreadDiscoveryPage(getHubD1(), {boardKeys:board?[board]:[],tags:tag?[tag]:[],query:(params.get("q") ?? "").slice(0,100)},after);
    return NextResponse.json(page,{headers:{"cache-control":"no-store"}});
  } catch { return NextResponse.json({error:"Threads unavailable"},{status:503,headers:{"cache-control":"no-store"}}); }
}
