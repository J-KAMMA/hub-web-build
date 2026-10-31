import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { generateStructured } from "@/lib/encyclopedia/ai";
import { reviewProposal,WikiConflictError } from "@/lib/server/hubpedia-wiki";

const reviewSchema=z.object({
  verdict:z.enum(["pass","human","fail"]),confidence:z.number().min(0).max(1),
  categories:z.array(z.enum(["factuality","citation","neutrality","copyright","safety","scope","none"])).max(7),
  highRisk:z.boolean()
});
type Review=z.infer<typeof reviewSchema>;
type Proposal={id:string;article_slug:string;title:string;summary:string|null;body_markdown:string;edit_summary:string;sources:string;risk_level:string;review_lane:string};

const blockedHosts=new Set(["localhost","localhost.localdomain","metadata.google.internal","169.254.169.254"]);
function safeSource(value:string){
  let url:URL;try{url=new URL(value);}catch{return null;}
  const host=url.hostname.toLowerCase().replace(/\.$/u,"");
  if(!/^https?:$/u.test(url.protocol)||blockedHosts.has(host)||host.endsWith(".local")||host.endsWith(".internal")||host.endsWith(".localhost")||host.includes(":"))return null;
  const ip=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if(ip){const p=ip.slice(1).map(Number);if(p.some(v=>v>255)||p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168))return null;}
  url.username="";url.password="";url.hash="";return url;
}

export async function inspectWikiSource(value:string,fetcher:typeof fetch=fetch){
  const url=safeSource(value);
  if(!url)return {status:"unsafe" as const,errorCategory:"unsafe_url",httpStatus:undefined};
  try{
    const response=await fetcher(url,{method:"GET",redirect:"follow",signal:AbortSignal.timeout(8000),headers:{accept:"text/html,application/xhtml+xml,text/plain,application/pdf","user-agent":"HubpediaSourceMonitor/1.0",range:"bytes=0-2047"}});
    const httpStatus=response.status,modified=response.headers.get("last-modified"),old=modified&&Date.parse(modified)<Date.now()-2*365*86400000;await response.body?.cancel();
    if(!response.ok)return {status:"unreachable" as const,errorCategory:"http_status",httpStatus};
    return {status:old?"stale" as const:"reachable" as const,errorCategory:old?"last_modified_old":null,httpStatus};
  }catch{return {status:"unreachable" as const,errorCategory:"fetch_failed",httpStatus:undefined};}
}

export async function checkWikiProposalSources(db:D1Database,proposal:Proposal,fetcher:typeof fetch=fetch){
  let values:string[]=[];try{values=JSON.parse(proposal.sources||"[]") as string[];}catch{values=[];}
  const checked:Array<{url:string;status:"reachable"|"stale"|"unreachable"|"unsafe";httpStatus?:number}>=[];
  for(const value of values.slice(0,12)){
    const result=await inspectWikiSource(value,fetcher),{status,httpStatus,errorCategory}=result;
    await db.prepare(`INSERT INTO hubpedia_wiki_source_health(article_slug,source_url,status,http_status,checked_at,error_category) VALUES(?,?,?,?,?,?)
      ON CONFLICT(article_slug,source_url) DO UPDATE SET status=excluded.status,http_status=excluded.http_status,checked_at=excluded.checked_at,error_category=excluded.error_category`).bind(proposal.article_slug,value,status,httpStatus??null,new Date().toISOString(),errorCategory).run();
    checked.push({url:value,status,httpStatus});
  }
  return checked;
}

export async function monitorDueWikiSources(db:D1Database,fetcher:typeof fetch=fetch,limit=25){
  const before=new Date(Date.now()-7*86400000).toISOString();
  const rows=await db.prepare(`SELECT q.id,a.slug article_slug,q.title,q.summary,q.body_markdown,q.edit_reason edit_summary,q.source_urls_json sources,q.risk_level,q.review_lane
    FROM hubpedia_wiki_proposals q JOIN hubpedia_wiki_articles a ON a.article_key=q.article_key WHERE q.source_urls_json<>'[]' AND q.status IN ('pending','approved') AND EXISTS (
      SELECT 1 FROM json_each(q.source_urls_json) s LEFT JOIN hubpedia_wiki_source_health h ON h.article_slug=a.slug AND h.source_url=s.value
      WHERE h.checked_at IS NULL OR h.checked_at<?) ORDER BY q.created_at DESC LIMIT ?`).bind(before,Math.max(1,Math.min(limit,100))).all<Proposal>();
  let proposals=0,sources=0,unhealthy=0;
  for(const proposal of rows.results??[]){const checked=await checkWikiProposalSources(db,proposal,fetcher);proposals+=1;sources+=checked.length;unhealthy+=checked.filter(item=>item.status==="unsafe"||item.status==="unreachable").length;}
  return {proposals,sources,unhealthy,checkedAt:new Date().toISOString()};
}

function compact(result:Review){return {verdict:result.verdict,confidence:Number(result.confidence.toFixed(2)),categories:[...new Set(result.categories)],highRisk:result.highRisk};}

export async function reviewWikiProposalWithAi(db:D1Database,proposalId:string){
  const proposal=await db.prepare(`SELECT q.id,a.slug article_slug,q.title,q.summary,q.body_markdown,q.edit_reason edit_summary,q.source_urls_json sources,q.risk_level,q.review_lane
    FROM hubpedia_wiki_proposals q JOIN hubpedia_wiki_articles a ON a.article_key=q.article_key WHERE q.id=? AND q.status='pending'`).bind(proposalId).first<Proposal>();
  if(!proposal)throw new WikiConflictError("Proposal is no longer pending.");
  if(proposal.review_lane!=="ai"||proposal.risk_level==="high")return {status:"human_required" as const};
  await db.prepare("UPDATE hubpedia_wiki_proposals SET ai_review_status='running' WHERE id=?").bind(proposalId).run();
  /* pipeline.ts imports the HTML extractor (jsdom); only load it when a proposal is actually reviewed. */
  const { createPipelineRun,JOBS,runPipelineStep }=await import("@/lib/encyclopedia/pipeline");
  const run=await createPipelineRun(JOBS.wikiReview,{proposalId},`wiki-review:${proposalId}`);
  try{return await runPipelineStep(run.id,async()=>{
    const sources=await checkWikiProposalSources(db,proposal);
    const sourceSummary=sources.map(source=>({status:source.status,httpStatus:source.httpStatus??null}));
    const article=JSON.stringify({title:proposal.title,summary:proposal.summary,bodyMarkdown:proposal.body_markdown,editSummary:proposal.edit_summary,sourceStatus:sourceSummary});
    const factual=await generateStructured<Review>(run.id,"wiki-factual-review","You are an independent encyclopedia fact and citation reviewer. Return JSON only. Mark human for uncertainty or claims needing expert review. Mark fail for clear falsehood, unsafe sourcing, or unverifiable major claims.",article,reviewSchema);
    const policy=await generateStructured<Review>(run.id,"wiki-policy-review","You are an independent encyclopedia neutrality, copyright, safety, and scope reviewer. Return JSON only. Mark human for medical, legal, financial, political, living-person, or other high-risk content. Mark fail for copied prose, advocacy, harmful instructions, or non-encyclopedic content.",article,reviewSchema);
    const a=compact(factual),b=compact(policy),badSource=sources.some(source=>source.status==="unreachable"||source.status==="unsafe");
    const pass=a.verdict==="pass"&&b.verdict==="pass"&&!a.highRisk&&!b.highRisk&&!badSource&&a.confidence>=0.8&&b.confidence>=0.8;
    const failed=a.verdict==="fail"||b.verdict==="fail";
    const status=pass?"passed":failed?"failed":"human_required";
    await db.prepare("UPDATE hubpedia_wiki_proposals SET ai_review_status=?,ai_review_result=? WHERE id=? AND status='pending'").bind(status,JSON.stringify({reviewA:a,reviewB:b,sourceStatuses:sourceSummary}),proposalId).run();
    if(pass)await reviewProposal(db,null,proposalId,true,"Two independent AI checks and source-health checks passed.");
    return {status,published:pass};
  });}catch(error){await db.prepare("UPDATE hubpedia_wiki_proposals SET ai_review_status='human_required',ai_review_result=? WHERE id=? AND status='pending'").bind(JSON.stringify({errorCategory:"review_unavailable"}),proposalId).run();throw error;}
}
