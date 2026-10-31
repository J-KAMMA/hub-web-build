import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { recordMcpUsage,recordSearchOutcome } from "@/lib/server/hubpedia-quality-operations";
import { searchMcpKnowledge } from "@/lib/server/hubpedia-mcp-data";
import { searchMcpClaims } from "@/lib/encyclopedia/mcp-knowledge";
import { conditionalJson,enforceMcpRateLimit,hashJson,rateHeaders } from "@/lib/server/hubpedia-mcp-public";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

export async function GET(request: Request) {
  const started=Date.now(),db=getHubD1(),rate=await enforceMcpRateLimit(db,request,"search");
  if(!rate.allowed)return NextResponse.json({error:"Rate limit exceeded."},{status:429,headers:rateHeaders(rate)});
  const url = new URL(request.url), query = url.searchParams.get("q") ?? "", limit = Number(url.searchParams.get("limit") ?? 8), type = url.searchParams.get("type") ?? "articles";
  /* type=claims searches sourced statements rather than whole articles — the
   * unit an agent cites when it grounds an answer. */
  const value = type === "claims"
    ? { query, results: await searchMcpClaims(query, limit) }
    : { query, results: await searchMcpKnowledge(db, query, limit) };
  const etag=await hashJson(value),conditional=request.headers.get("if-none-match")===`\"${etag}\"`;
  await Promise.all([recordMcpUsage(db,type==="claims"?"search_claims":"search_articles",JSON.stringify(value).length,{conditionalHit:conditional,milliseconds:Date.now()-started}),recordSearchOutcome(db,{query,resultCount:value.results.length,outcome:"shown"})]);
  return conditionalJson(request,value,etag, { ...publicApiCacheHeaders(request,"hubpedia.search"), "x-content-type-options": "nosniff",...rateHeaders(rate) });
}
