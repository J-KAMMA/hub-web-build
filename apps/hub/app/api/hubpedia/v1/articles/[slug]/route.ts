import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { recordMcpUsage } from "@/lib/server/hubpedia-quality-operations";
import { getMcpRelated,resolveMcpArticle,resolveMcpClaims,resolveMcpDiff,resolveMcpHistory,resolveMcpKnowledgeState,resolveMcpSection } from "@/lib/server/hubpedia-mcp-data";
import { conditionalJson,enforceMcpRateLimit,hashJson,rateHeaders } from "@/lib/server/hubpedia-mcp-public";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){
 const started=Date.now(),db=getHubD1(),rate=await enforceMcpRateLimit(db,request,"read");
 if(!rate.allowed)return NextResponse.json({error:"Rate limit exceeded."},{status:429,headers:rateHeaders(rate)});
 const {slug}=await params,url=new URL(request.url),locale=url.searchParams.get("locale")==="en"?"en":"ja",view=url.searchParams.get("view")??"article";
 let value:unknown;
 if(view==="related")value=await getMcpRelated(slug,Number(url.searchParams.get("limit")??8));
 else if(view==="section")value=await resolveMcpSection(db,slug,url.searchParams.get("section")??"",locale);
 else if(view==="history")value=await resolveMcpHistory(db,slug);
 else if(view==="claims"){const claimId=url.searchParams.get("claimId"),claims=await resolveMcpClaims(db,slug);value={slug,claims:claimId?claims.filter(claim=>(claim as {id?:string}).id===claimId):claims};}
 else if(view==="knowledge")value=await resolveMcpKnowledgeState(db,slug);
 else if(view==="diff")value=await resolveMcpDiff(db,slug,Number(url.searchParams.get("since")??1));
 else{
  const article=await resolveMcpArticle(db,slug,locale),max=Math.max(500,Math.min(60000,Number(url.searchParams.get("maxCharacters")??60000))),includeBody=url.searchParams.get("includeBody")!=="false",includeSources=url.searchParams.get("includeSources")!=="false";
  value=view==="sources"&&article?{slug,revisionKey:article.revisionKey,sources:article.sources}:view==="freshness"&&article?{slug,revisionKey:article.revisionKey,freshness:article.freshness,quality:article.quality,contentHash:article.contentHash}:view==="summary"&&article?{slug,revisionKey:article.revisionKey,title:article.title,summary:article.summary,quality:article.quality,freshness:article.freshness,sources:article.sources.slice(0,5),contentHash:article.contentHash}:article?{...article,bodyMarkdown:includeBody?article.bodyMarkdown.slice(0,max):undefined,sources:includeSources?article.sources:undefined}:null;
 }
 if(!value)return NextResponse.json({error:"Article or section not found."},{status:404});
 const etag=await hashJson(value),conditional=request.headers.get("if-none-match")===`\"${etag}\"`;
 await recordMcpUsage(db,view==="article"?"get_article":view,JSON.stringify(value).length,{conditionalHit:conditional,milliseconds:Date.now()-started});
 return conditionalJson(request,value,etag,{...publicApiCacheHeaders(request,"hubpedia.article"),"x-content-type-options":"nosniff",...rateHeaders(rate)});
}
