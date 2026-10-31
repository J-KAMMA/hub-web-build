import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { ViewableSeedArticle } from "@/lib/encyclopedia/seed";
import { publicationGate } from "@/lib/encyclopedia/publication-operations";

export type AutomationControl = { enabled: boolean; reason: string | null; consecutiveFailures: number; updatedAt: string };

export async function getAutomationControl(db: D1Database): Promise<AutomationControl> {
  const row = await db.prepare(`SELECT enabled, reason, consecutive_failures consecutiveFailures, updated_at updatedAt FROM hubpedia_operation_control WHERE control_key='automation'`).first<{enabled:number;reason:string|null;consecutiveFailures:number;updatedAt:string}>();
  return row ? { ...row, enabled: row.enabled === 1 } : { enabled: false, reason: "Operation control is not initialized.", consecutiveFailures: 0, updatedAt: new Date(0).toISOString() };
}

export async function setAutomationControl(db: D1Database, enabled: boolean, reason: string | null) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO hubpedia_operation_control(control_key,enabled,reason,consecutive_failures,updated_at) VALUES('automation',?,?,0,?) ON CONFLICT(control_key) DO UPDATE SET enabled=excluded.enabled,reason=excluded.reason,consecutive_failures=0,updated_at=excluded.updated_at`).bind(enabled ? 1 : 0, reason?.slice(0, 300) ?? null, now).run();
  return getAutomationControl(db);
}

export async function recordAutomationFailure(db: D1Database, reason: string, threshold = 3) {
  const current = await getAutomationControl(db);
  const failures = current.consecutiveFailures + 1;
  const enabled = failures < threshold;
  const now = new Date().toISOString();
  await db.prepare(`UPDATE hubpedia_operation_control SET enabled=?,reason=?,consecutive_failures=?,updated_at=? WHERE control_key='automation'`).bind(enabled ? 1 : 0, reason.slice(0, 300), failures, now).run();
  return { enabled, failures, tripped: !enabled };
}

export async function enqueueRepair(db: D1Database, input: { slug: string; reasonCode: string; priority: number; assessment: unknown }) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO hubpedia_repair_queue(id,article_slug,reason_code,priority,assessment,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), input.slug, input.reasonCode, Math.round(input.priority), JSON.stringify(input.assessment), now, now, now).run();
}

export async function claimRepairBatch(db: D1Database, limit = 5) {
  const control = await getAutomationControl(db);
  if (!control.enabled) return [];
  const size = Math.max(1, Math.min(5, Math.floor(limit)));
  const rows = await db.prepare(`SELECT id,article_slug articleSlug,reason_code reasonCode,priority,assessment,attempt_count attemptCount FROM hubpedia_repair_queue WHERE status='queued' AND available_at<=? ORDER BY priority DESC,created_at LIMIT ?`).bind(new Date().toISOString(), size).all<Record<string, unknown>>();
  const selected = rows.results ?? [];
  if (selected.length) await db.batch(selected.map((row) => db.prepare(`UPDATE hubpedia_repair_queue SET status='running',attempt_count=attempt_count+1,updated_at=? WHERE id=? AND status='queued'`).bind(new Date().toISOString(), row.id)));
  return selected;
}

export async function upsertSourceLicense(db: D1Database, input: { host: string; licenseName?: string | null; licenseUrl?: string | null; reuseStatus: "allowed"|"attribution-required"|"review-required"|"blocked"; attributionTemplate?: string | null }) {
  const host = input.host.trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error("Invalid source host.");
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO hubpedia_source_license_registry(source_host,license_name,license_url,reuse_status,attribution_template,reviewed_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_host) DO UPDATE SET license_name=excluded.license_name,license_url=excluded.license_url,reuse_status=excluded.reuse_status,attribution_template=excluded.attribution_template,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at`).bind(host,input.licenseName??null,input.licenseUrl??null,input.reuseStatus,input.attributionTemplate??null,now,now).run();
}

export async function recordSearchOutcome(db: D1Database, input: { query: string; resultCount: number; clickedSlug?: string | null; outcome: "shown"|"clicked"|"abandoned" }) {
  const normalized = input.query.normalize("NFKC").trim().toLocaleLowerCase("ja").slice(0, 120);
  if (!normalized) return;
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  await db.prepare(`INSERT INTO hubpedia_search_events(id,query_hash,normalized_query,result_count,clicked_slug,outcome,created_at) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),hash,normalized,Math.max(0,Math.floor(input.resultCount)),input.clickedSlug??null,input.outcome,new Date().toISOString()).run();
}

export async function saveArticleAudit(db: D1Database, input: { slug: string; revisionKey: string; score: number; publishable: boolean; blockers: unknown; changedBlocks?: string[]; changeReason?: string | null }) {
  await db.prepare(`INSERT INTO hubpedia_article_audits(id,article_slug,revision_key,quality_score,publishable,blockers,changed_blocks,change_reason,checked_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(article_slug,revision_key) DO UPDATE SET quality_score=excluded.quality_score,publishable=excluded.publishable,blockers=excluded.blockers,changed_blocks=excluded.changed_blocks,change_reason=excluded.change_reason,checked_at=excluded.checked_at`).bind(crypto.randomUUID(),input.slug,input.revisionKey,input.score,input.publishable?1:0,JSON.stringify(input.blockers),JSON.stringify(input.changedBlocks??[]),input.changeReason?.slice(0,500)??null,new Date().toISOString()).run();
}

export async function recordMcpUsage(db:D1Database,toolName:string,responseCharacters:number,options:{cacheHit?:boolean;conditionalHit?:boolean;milliseconds?:number;error?:boolean;webFetchesAvoided?:number}={}){const date=new Date().toISOString().slice(0,10),characters=Math.max(0,Math.floor(responseCharacters)),tokens=Math.ceil(characters/4),cacheHit=options.cacheHit!==false;await db.prepare(`INSERT INTO hubpedia_mcp_usage_daily(usage_date,tool_name,request_count,cache_hit_count,response_characters,estimated_tokens_saved,error_count,conditional_hit_count,response_milliseconds,estimated_web_fetches_avoided) VALUES(?,?,1,?,?,?,?,?,?,?) ON CONFLICT(usage_date,tool_name) DO UPDATE SET request_count=request_count+1,cache_hit_count=cache_hit_count+excluded.cache_hit_count,response_characters=response_characters+excluded.response_characters,estimated_tokens_saved=estimated_tokens_saved+excluded.estimated_tokens_saved,error_count=error_count+excluded.error_count,conditional_hit_count=conditional_hit_count+excluded.conditional_hit_count,response_milliseconds=response_milliseconds+excluded.response_milliseconds,estimated_web_fetches_avoided=estimated_web_fetches_avoided+excluded.estimated_web_fetches_avoided`).bind(date,toolName,cacheHit?1:0,characters,tokens,options.error?1:0,options.conditionalHit?1:0,Math.max(0,Math.round(options.milliseconds??0)),Math.max(0,Math.round(options.webFetchesAvoided??(cacheHit?3:0)))).run();}

export async function getHubpediaOperationsSnapshot(db:D1Database,totalSeedArticles:number){const [articles,claims,sources,freshness,repairs,reports,usage,migrations]=await Promise.all([
 db.prepare(`SELECT count(*) total,sum(CASE WHEN a.status='published' THEN 1 ELSE 0 END) published,sum(CASE WHEN aa.publishable=0 THEN 1 ELSE 0 END) blocked FROM encyclopedia_articles a LEFT JOIN hubpedia_article_audits aa ON aa.article_slug=a.slug AND aa.revision_key='db:'||COALESCE((SELECT revision_number FROM encyclopedia_article_revisions WHERE id=a.current_revision_id),0)`).first<Record<string,number>>(),
 db.prepare(`SELECT count(DISTINCT rc.claim_id) claims,count(DISTINCT CASE WHEN ce.chunk_id IS NOT NULL THEN rc.claim_id END) evidenced FROM encyclopedia_revision_claims rc JOIN encyclopedia_articles a ON a.current_revision_id=rc.revision_id LEFT JOIN encyclopedia_claim_evidence ce ON ce.claim_id=rc.claim_id WHERE a.status='published'`).first<Record<string,number>>(),
 db.prepare(`SELECT count(*) total,sum(CASE WHEN is_active=1 THEN 1 ELSE 0 END) active FROM encyclopedia_sources`).first<Record<string,number>>(),
 db.prepare(`SELECT count(*) open FROM hubpedia_freshness_events WHERE resolved_at IS NULL`).first<{open:number}>(),
 db.prepare(`SELECT status,count(*) count FROM hubpedia_repair_queue GROUP BY status`).all(),
 db.prepare(`SELECT status,count(*) count,sum(duplicate_count) reports FROM hubpedia_mcp_reports GROUP BY status`).all(),
 db.prepare(`SELECT sum(request_count) requests,sum(cache_hit_count) cacheHits,sum(error_count) errors,sum(response_characters) responseCharacters,sum(estimated_tokens_saved) tokensSaved,sum(estimated_web_fetches_avoided) webFetchesAvoided,CASE WHEN sum(request_count)>0 THEN round(1.0*sum(response_milliseconds)/sum(request_count),1) ELSE 0 END averageMilliseconds FROM hubpedia_mcp_usage_daily WHERE usage_date>=date('now','-30 day')`).first(),
 db.prepare(`SELECT status,count(*) count FROM hubpedia_knowledge_migrations GROUP BY status`).all()
]);const claimCount=Number(claims?.claims??0),evidenced=Number(claims?.evidenced??0),dbTotal=Number(articles?.total??0);return {articles:{seedTotal:totalSeedArticles,databaseTotal:dbTotal,published:Number(articles?.published??0),blocked:Number(articles?.blocked??0),migrationPercent:totalSeedArticles?Math.round(dbTotal/totalSeedArticles*1000)/10:100},evidence:{claims:claimCount,evidenced,coverage:claimCount?Math.round(evidenced/claimCount*1000)/10:0,sources:Number(sources?.total??0),activeSources:Number(sources?.active??0)},freshness:{openEvents:Number(freshness?.open??0)},repairs:repairs.results??[],reports:reports.results??[],usage:usage??{},migrations:migrations.results??[]};}

export async function migrateSeedArticleBatch(db:D1Database,catalog:readonly ViewableSeedArticle[],limit=5,linkCatalog:readonly ViewableSeedArticle[]=catalog){const size=Math.max(1,Math.min(5,Math.floor(limit))),existing=await db.prepare(`SELECT slug FROM encyclopedia_articles`).all<{slug:string}>(),known=new Set((existing.results??[]).map(row=>row.slug)),selected=catalog.filter(article=>!known.has(article.slug)).slice(0,size),results: Array<{slug:string;status:string}> = [];
 for(const article of selected){const now=Date.now(),topicId=crypto.randomUUID(),articleId=crypto.randomUUID(),revisionId=crypto.randomUUID(),gate=publicationGate(article,linkCatalog),status=gate.publishable?"published":"draft";try{const statements=[
  db.prepare(`INSERT INTO encyclopedia_topics(id,canonical_name,slug,description,topic_type,external_ids,status,freshness_interval_hours,created_at,updated_at) VALUES(?,?,?,?,?,'{}','active',?,?,?)`).bind(topicId,article.title,article.slug,article.summary??null,article.topicType,/(?:medical|law|price|election|医療|法律|価格|選挙)/iu.test(`${article.topicType} ${article.categoryLabel}`)?2160:8760,now,now),
  db.prepare(`INSERT INTO encyclopedia_articles(id,topic_id,title,slug,status,current_revision_id,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?)`).bind(articleId,topicId,article.title,article.slug,status,now,now),
  db.prepare(`INSERT INTO encyclopedia_article_revisions(id,article_id,revision_number,title,body_markdown,summary,generation_metadata,created_by,created_at,author_kind) VALUES(?,?,1,?,?,?,?,'seed-migration',?,'human')`).bind(revisionId,articleId,article.title,article.bodyMarkdown,article.summary??null,JSON.stringify({source:"seed",qualityGate:gate}),now),
  db.prepare(`UPDATE encyclopedia_articles SET current_revision_id=? WHERE id=?`).bind(revisionId,articleId),
  ...Object.entries(article.translations??{}).map(([locale,translation])=>db.prepare(`INSERT INTO encyclopedia_article_translations(id,source_revision_id,locale,title,summary,body_markdown,status,generation_metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'{}',?,?)`).bind(crypto.randomUUID(),revisionId,locale,translation.title,translation.summary??null,translation.bodyMarkdown,status,now,now)),
  ...article.sources.map(source=>db.prepare(`INSERT INTO encyclopedia_sources(id,topic_id,url,normalized_url,title,publisher,authors,source_type,language,license,reliability_tier,metadata,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,'[]',?,?,?,?,?,1,?,?)`).bind(crypto.randomUUID(),topicId,source.url,source.url,source.title??null,source.publisher??null,"web",source.language??null,source.license??null,source.reliabilityTier??null,JSON.stringify(source.metadata??{}),now,now)),
  db.prepare(`INSERT INTO hubpedia_knowledge_migrations(article_slug,source_revision_key,destination_revision_id,status,migrated_at,updated_at) VALUES(?, ?, ?, 'migrated', ?, ?) ON CONFLICT(article_slug) DO UPDATE SET destination_revision_id=excluded.destination_revision_id,status='migrated',migrated_at=excluded.migrated_at,updated_at=excluded.updated_at`).bind(article.slug,`seed:${article.slug}`,revisionId,new Date(now).toISOString(),new Date(now).toISOString())
 ];await db.batch(statements);await saveArticleAudit(db,{slug:article.slug,revisionKey:`db:1`,score:gate.score,publishable:gate.publishable,blockers:gate.blockers,changeReason:"Seed-to-database migration"});if(!gate.publishable)await enqueueRepair(db,{slug:article.slug,reasonCode:gate.blockers[0]?.code??"quality",priority:100-gate.score,assessment:gate});results.push({slug:article.slug,status});}catch(error){await db.prepare(`INSERT INTO hubpedia_knowledge_migrations(article_slug,source_revision_key,status,error_category,updated_at) VALUES(?,?,'failed',?,?) ON CONFLICT(article_slug) DO UPDATE SET status='failed',error_category=excluded.error_category,updated_at=excluded.updated_at`).bind(article.slug,`seed:${article.slug}`,error instanceof Error?error.name:"unknown",new Date().toISOString()).run();results.push({slug:article.slug,status:"failed"});}}
 if(results.some(item=>item.status!=="failed")){const{ synchronizeHubpediaCategoryRegistry }=await import("@/lib/server/hubpedia-category-registry");await synchronizeHubpediaCategoryRegistry(db,linkCatalog);}
 return {requested:size,processed:results.length,remaining:Math.max(0,catalog.length-known.size-results.filter(item=>item.status!=="failed").length),results};}

export async function reevaluateMigratedArticles(db:D1Database,publicCatalog:readonly ViewableSeedArticle[],linkCatalog:readonly ViewableSeedArticle[]){const rows=await db.prepare(`SELECT slug FROM encyclopedia_articles`).all<{slug:string}>(),bySlug=new Map(publicCatalog.map(article=>[article.slug,article])),results=[];for(const row of rows.results??[]){const article=bySlug.get(row.slug);if(!article)continue;const gate=publicationGate(article,linkCatalog),status=gate.publishable?"published":"draft";await db.prepare(`UPDATE encyclopedia_articles SET status=?,updated_at=? WHERE slug=?`).bind(status,Date.now(),row.slug).run();await saveArticleAudit(db,{slug:row.slug,revisionKey:"db:1",score:gate.score,publishable:gate.publishable,blockers:gate.blockers,changeReason:"Full-catalog link re-evaluation"});results.push({slug:row.slug,status,blockers:gate.blockers});}return {processed:results.length,published:results.filter(item=>item.status==="published").length,results};}

function claimCandidates(markdown:string){return markdown.replace(/```[\s\S]*?```/gu,"").split(/\n\s*\n/gu).map(value=>value.replace(/^#+\s+.+$/gmu,"").replace(/\[[^\]]+\]\([^)]*\)/gu,match=>match.replace(/\]\([^)]*\)$/u,"]")).trim()).filter(value=>value.length>=40&&!/^(?:出典|参考文献|sources|references)/iu.test(value)).flatMap(value=>value.split(/(?<=[。！？.!?])\s*/u)).map(value=>value.trim()).filter(value=>value.length>=30&&value.length<=500).slice(0,15);}
export async function backfillStructuredKnowledge(db:D1Database,limit=1){const size=Math.max(1,Math.min(5,Math.floor(limit))),articles=await db.prepare(`SELECT a.id articleId,a.slug,a.topic_id topicId,a.current_revision_id revisionId,r.body_markdown bodyMarkdown,t.last_verified_at lastVerifiedAt,t.freshness_interval_hours freshnessHours FROM encyclopedia_articles a JOIN encyclopedia_article_revisions r ON r.id=a.current_revision_id JOIN encyclopedia_topics t ON t.id=a.topic_id WHERE a.status='published' AND NOT EXISTS(SELECT 1 FROM encyclopedia_revision_claims rc WHERE rc.revision_id=a.current_revision_id) ORDER BY a.slug LIMIT ?`).bind(size).all<{articleId:string;slug:string;topicId:string;revisionId:string;bodyMarkdown:string;lastVerifiedAt:number|null;freshnessHours:number}>(),results=[];for(const article of articles.results??[]){const now=Date.now(),candidates=claimCandidates(article.bodyMarkdown),statements=[];for(const [index,statement] of candidates.entries()){const claimId=crypto.randomUUID();statements.push(db.prepare(`INSERT INTO encyclopedia_claims(id,topic_id,statement,normalized_statement,status,confidence,metadata,created_at,updated_at) VALUES(?,?,?,?, 'proposed',NULL,?, ?,?)`).bind(claimId,article.topicId,statement,statement.normalize("NFKC").toLocaleLowerCase("ja"),JSON.stringify({origin:"article-paragraph",verification:"required"}),now,now));statements.push(db.prepare(`INSERT INTO encyclopedia_revision_claims(revision_id,claim_id,citation_index,section_path,created_at) VALUES(?,?,?,'[]',?)`).bind(article.revisionId,claimId,index+1,now));}if(statements.length)await db.batch(statements);if(!article.lastVerifiedAt){await db.prepare(`INSERT INTO hubpedia_freshness_events(id,article_slug,event_type,detail,detected_at) SELECT ?,?,'verification-due','No verified evidence checkpoint is registered.',? WHERE NOT EXISTS(SELECT 1 FROM hubpedia_freshness_events WHERE article_slug=? AND event_type='verification-due' AND resolved_at IS NULL)`).bind(crypto.randomUUID(),article.slug,new Date().toISOString(),article.slug).run();}results.push({slug:article.slug,claimsInserted:candidates.length,verification:article.lastVerifiedAt?"verified":"required"});}return {processed:results.length,claimsInserted:results.reduce((sum,item)=>sum+item.claimsInserted,0),results};}
