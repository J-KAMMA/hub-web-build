import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { recordMcpUsage } from "@/lib/server/hubpedia-quality-operations";
import { listMcpCatalog, listMcpCatalogPage } from "@/lib/server/hubpedia-mcp-data";
import { readListPagination } from "@/lib/server/list-pagination";
import { conditionalJson,enforceMcpRateLimit,hashJson,rateHeaders } from "@/lib/server/hubpedia-mcp-public";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

/* Catalog enumeration for agents: slug, title, category — enough to pick a
 * get_article call without guessing slugs. */
export async function GET(request:Request){
 const started=Date.now(),db=getHubD1(),rate=await enforceMcpRateLimit(db,request,"read");
 if(!rate.allowed)return NextResponse.json({error:"Rate limit exceeded."},{status:429,headers:rateHeaders(rate)});
 const url=new URL(request.url),category=url.searchParams.get("category")??undefined,limit=Number(url.searchParams.get("limit")??500);
 if (url.searchParams.get("pageMode") === "1") {
   const query = (url.searchParams.get("q") ?? "").trim(), page = readListPagination(url);
   if (query.length > 100 || query.split(/\s+/u).length > 8) return NextResponse.json({error:"invalid_query"},{status:400});
   return NextResponse.json(await listMcpCatalogPage(db, query, page.limit, page.offset), {headers:{...publicApiCacheHeaders(request,"hubpedia.article"),...rateHeaders(rate)}});
 }
 const articles=await listMcpCatalog(db,category,limit),value={count:articles.length,articles};
 const etag=await hashJson(value),conditional=request.headers.get("if-none-match")===`\"${etag}\"`;
 await recordMcpUsage(db,"list_articles",JSON.stringify(value).length,{conditionalHit:conditional,milliseconds:Date.now()-started});
 return conditionalJson(request,value,etag,{...publicApiCacheHeaders(request,"hubpedia.article"),"x-content-type-options":"nosniff",...rateHeaders(rate)});
}
