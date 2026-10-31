import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { getPublicSeedArticle } from "@/lib/encyclopedia/public-seed";
import { persistExplanationBlocks } from "@/lib/server/hubpedia-explanations";
import { ClaimConflict,prepareClaimEffects } from "@/lib/server/hubpedia-claim-effects";
import { assertEditorNotSuspended,getSensitiveCategory,WikiPermissionError } from "@/lib/server/hubpedia-wiki-policy";

export class WikiInputError extends Error {}
export class WikiConflictError extends Error {}
export class WikiRateLimitError extends Error {}

const slugOf = (value: string) => {
  const slug = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u.test(slug)) throw new WikiInputError("Invalid article slug.");
  return slug;
};
const textOf = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== "string") throw new WikiInputError(`${name} is required.`);
  const result = value.normalize("NFC").trim();
  if (result.length < min || result.length > max) throw new WikiInputError(`${name} has an invalid length.`);
  return result;
};

type WikiRisk = "low" | "medium" | "high";
type BaseContent = { title:string; summary:string; bodyMarkdown:string };

function semanticText(value:string){return value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu,"").toLocaleLowerCase("ja");}
function changedCharacters(left:string,right:string){const max=Math.max(left.length,right.length);let changed=Math.abs(left.length-right.length);for(let i=0;i<Math.min(left.length,right.length);i+=1)if(left[i]!==right[i])changed+=1;return Math.min(changed,max);}
const HIGH_RISK_TERMS=/医療|治療|診断|薬|疾患|法律|訴訟|犯罪|投資|金融|株価|暗号資産|政治|選挙|政府|人物|企業|事故|事件|批判|差別|自殺|health|medical|legal|finance|investment|politic|election/iu;

export function classifyWikiChange(base:BaseContent,next:BaseContent,sources:string[]){
  const titleChanged=base.title.trim()!==next.title.trim(),summaryChanged=(base.summary??"").trim()!==(next.summary??"").trim();
  const semanticEqual=semanticText(base.bodyMarkdown)===semanticText(next.bodyMarkdown);
  const changed=changedCharacters(base.bodyMarkdown,next.bodyMarkdown);
  const ratio=changed/Math.max(1,base.bodyMarkdown.length);
  const highRisk=HIGH_RISK_TERMS.test(`${next.title}\n${next.summary}\n${next.bodyMarkdown.slice(0,3000)}`);
  let risk:WikiRisk="medium",lane:"ai"|"human"|"instant"="ai";
  if(!titleChanged&&!summaryChanged&&semanticEqual){risk="low";lane="instant";}
  else if(!titleChanged&&!summaryChanged&&!highRisk&&sources.length===0&&changed<=20&&ratio<=0.01&&!/[0-9]/u.test(next.bodyMarkdown.slice(0,Math.max(0,next.bodyMarkdown.length-base.bodyMarkdown.length)))){risk="low";lane="instant";}
  else if(highRisk||titleChanged||ratio>0.2||sources.length>0){risk="high";lane="human";}
  return {risk,lane,checks:{titleChanged,summaryChanged,semanticEqual,changedCharacters:changed,changeRatio:Number(ratio.toFixed(4)),highRisk,sources:sources.length}};
}

export async function getBaseContent(db:D1Database,slug:string):Promise<BaseContent|null>{
  const wiki=await getWikiArticle(db,slug);if(wiki)return {title:wiki.title,summary:wiki.summary??"",bodyMarkdown:wiki.bodyMarkdown};
  const stored=await db.prepare(`SELECT r.title,r.summary,r.body_markdown bodyMarkdown FROM encyclopedia_articles a
    JOIN encyclopedia_article_revisions r ON r.id=a.current_revision_id WHERE a.slug=? AND a.status='published' LIMIT 1`).bind(slug).first<BaseContent>();
  if(stored)return stored;
  const seed=await getPublicSeedArticle(slug);return seed?{title:seed.title,summary:seed.summary??"",bodyMarkdown:seed.bodyMarkdown}:null;
}

// ---------------------------------------------------------------------------
// Article identity. Since migration 0073 the wiki tables are keyed by
// `article_key` (static:<seed slug> | d1:<id> | encyclopedia:<id>); callers
// still address articles by slug, so resolve slug -> article_key here.
// ---------------------------------------------------------------------------
export type AuthorKind = "ai" | "human" | "hybrid";
export const MAX_REVISION_CONTRIBUTORS = 20;

const KIND_PRIORITY = `CASE source_kind WHEN 'encyclopedia_article' THEN 0 WHEN 'd1_article' THEN 1 ELSE 2 END`;

async function findArticleKey(db:D1Database,slug:string){
  const row=await db.prepare(`SELECT article_key articleKey FROM hubpedia_wiki_articles WHERE slug=? ORDER BY ${KIND_PRIORITY} LIMIT 1`).bind(slug).first<{articleKey:string}>();
  return row?.articleKey??null;
}

/** Returns the wiki article_key for a slug, creating the wiki row on first use. */
export async function ensureWikiArticle(db:D1Database,slugValue:string,now=new Date().toISOString()){
  const slug=slugOf(slugValue);
  const existing=await findArticleKey(db,slug);if(existing)return existing;
  const stored=await db.prepare("SELECT id FROM encyclopedia_articles WHERE slug=? LIMIT 1").bind(slug).first<{id:string}>();
  const kind=stored?"encyclopedia_article":"static_seed",sourceId=stored?stored.id:slug,key=stored?`encyclopedia:${stored.id}`:`static:${slug}`;
  await db.prepare(`INSERT OR IGNORE INTO hubpedia_wiki_articles(article_key,source_kind,source_id,slug,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(key,kind,sourceId,slug,now,now).run();
  return (await findArticleKey(db,slug))??key;
}

function boundedContributors(...groups:Array<ReadonlyArray<string|null|undefined>>){
  const ids:string[]=[];for(const group of groups)for(const id of group)if(id&&!ids.includes(id))ids.push(id);
  return ids.slice(0,MAX_REVISION_CONTRIBUTORS);
}
function parseContributors(value:unknown){try{const parsed=JSON.parse(String(value??"[]"));return Array.isArray(parsed)?parsed.filter((v):v is string=>typeof v==="string"):[];}catch{return [] as string[];}}

export async function getWikiRevisionKey(db:D1Database,slugValue:string){
  const slug=slugOf(slugValue);
  const wiki=await db.prepare(`SELECT r.revision_number revisionNumber FROM hubpedia_wiki_articles a JOIN hubpedia_wiki_revisions r ON r.id=a.published_revision_id
    WHERE a.slug=? AND r.copyright_hidden_at IS NULL ORDER BY ${KIND_PRIORITY.replace("source_kind","a.source_kind")} LIMIT 1`).bind(slug).first<{revisionNumber:number}>();
  if(wiki)return `wiki:${wiki.revisionNumber}`;
  const stored=await db.prepare(`SELECT r.revision_number revisionNumber FROM encyclopedia_articles a
    JOIN encyclopedia_article_revisions r ON r.id=a.current_revision_id WHERE a.slug=? AND a.status='published' LIMIT 1`).bind(slug).first<{revisionNumber:number}>();
  return stored?`db:${stored.revisionNumber}`:"seed";
}

async function notify(db:D1Database,receiver:string,actor:string|null,text:string,targetId:string,now:string){
  await db.prepare(`INSERT INTO notifications(id,receiver_profile_id,actor_profile_id,notification_type,target_type,target_id,text,is_read,created_at)
    VALUES(?,?,?,'system','system',?,?,0,?)`).bind(crypto.randomUUID(),receiver,actor,targetId,text.slice(0,1000),now).run();
}

export async function getWikiArticle(db: D1Database, slugValue: string) {
  return db.prepare(`SELECT r.id revisionId, r.revision_number revisionNumber, r.title, r.summary,
    r.body_markdown bodyMarkdown, r.edit_reason editSummary, r.created_at createdAt,
    r.author_kind authorKind, r.contributors_json contributorsJson, r.ai_run_id aiRunId
    FROM hubpedia_wiki_articles a JOIN hubpedia_wiki_revisions r ON r.id=a.published_revision_id
    WHERE a.slug=? ORDER BY ${KIND_PRIORITY.replace("source_kind","a.source_kind")} LIMIT 1`).bind(slugOf(slugValue)).first<{
      revisionId:string; revisionNumber:number; title:string; summary:string|null;
      bodyMarkdown:string; editSummary:string; createdAt:string;
      authorKind:AuthorKind; contributorsJson:string; aiRunId:string|null;
    }>();
}

export async function getHubpediaWikiDiff(db:D1Database,slugValue:string,fromRevisionId:string|null,toRevisionId:string){
  const slug=slugOf(slugValue.replace(/^static:/u,""));
  const ids=[fromRevisionId,toRevisionId].filter((value):value is string=>Boolean(value));
  const result=await db.prepare(`SELECT r.id,r.title,r.summary,r.body_markdown bodyMarkdown,r.revision_number revisionNumber,r.author_kind authorKind
    FROM hubpedia_wiki_revisions r JOIN hubpedia_wiki_articles a ON a.article_key=r.article_key
    WHERE a.slug=? AND r.copyright_hidden_at IS NULL AND r.id IN (${ids.map(()=>"?").join(",")})`).bind(slug,...ids).all<Record<string,unknown>>();
  const rows=result.results??[],to=rows.find(row=>row.id===toRevisionId),from=fromRevisionId?rows.find(row=>row.id===fromRevisionId):null;
  if(!to)throw new WikiInputError("指定された版が見つかりません。");
  const before=String(from?.bodyMarkdown??"").split("\n"),after=String(to.bodyMarkdown??"").split("\n");
  const max=Math.max(before.length,after.length),lines:Array<{kind:"same"|"removed"|"added";text:string}>=[];
  for(let i=0;i<max;i+=1){
    if(before[i]===after[i]&&before[i]!==undefined) lines.push({kind:"same",text:before[i]});
    else {
      if(before[i]!==undefined) lines.push({kind:"removed",text:before[i]});
      if(after[i]!==undefined) lines.push({kind:"added",text:after[i]});
    }
  }
  return {from:from??null,to,lines};
}

export function normalizeSourceUrls(values:unknown){
  return Array.isArray(values)?values.slice(0,12).map((v)=>{let u:URL;try{u=new URL(String(v));}catch{throw new WikiInputError("Invalid source URL.");}if(!/^https?:$/u.test(u.protocol))throw new WikiInputError("Invalid source URL.");u.hash="";return u.toString();}):[];
}

export type PreparedWikiProposal={slug:string;title:string;summary:string;bodyMarkdown:string;editReason:string;baseRevisionKey:string;sources:string[]};
export type ProposalExtraStatements=(proposalId:string,articleKey:string,now:string)=>ReturnType<D1Database["prepare"]>[];

const RATE_LIMIT_BY_TRUST:Record<string,number>={newcomer:10,established:20,trusted:40};

/** Shared gate for every human proposal: suspension, protection and the per-trust rate limit. */
export async function assertCanSubmitProposal(db:D1Database,actor:Profile,slug:string){
  const nowIso=new Date().toISOString();
  await assertEditorNotSuspended(db,actor.id,nowIso);
  const protection=await db.prepare("SELECT protected_until protectedUntil,protection_reason reason FROM hubpedia_wiki_articles WHERE slug=? AND protected_until IS NOT NULL ORDER BY protected_until DESC LIMIT 1").bind(slug).first<{protectedUntil:string|null;reason:string|null}>();
  if(protection?.protectedUntil&&protection.protectedUntil>nowIso)throw new WikiConflictError(`This article is protected${protection.reason?`: ${protection.reason}`:""}.`);
  const trust=await db.prepare("SELECT level FROM hubpedia_wiki_editor_trust WHERE profile_id=?").bind(actor.id).first<{level:string}>();
  const limit=RATE_LIMIT_BY_TRUST[trust?.level??"newcomer"]??10;
  const recent=await db.prepare("SELECT count(*) count FROM hubpedia_wiki_proposals WHERE editor_profile_id=? AND created_at>=?")
    .bind(actor.id,new Date(Date.now()-3600000).toISOString()).first<{count:number}>();
  if((recent?.count??0)>=limit) throw new WikiRateLimitError("Too many proposals.");
}

export async function createWikiProposal(db:D1Database,actor:Profile,input:PreparedWikiProposal,options:{forceHuman?:boolean;extra?:ProposalExtraStatements}={}){
  const {slug,title,summary,bodyMarkdown,editReason,baseRevisionKey,sources}=input;
  const base=await getBaseContent(db,slug);if(!base)throw new WikiInputError("Article was not found.");
  const classification=classifyWikiChange(base,{title,summary,bodyMarkdown},sources);
  // Medical, legal and financial entries always take the human lane (design section 10).
  const sensitive=await getSensitiveCategory(db,slug,`${title}\n${summary}\n${bodyMarkdown}`);
  const forceHuman=Boolean(options.forceHuman||sensitive);
  const lane=forceHuman?"human":classification.lane,risk=forceHuman?"high":classification.risk;
  const checks={...classification.checks,...(sensitive?{sensitiveCategory:sensitive}:{})};
  const id=crypto.randomUUID(), now=new Date().toISOString();
  const articleKey=await ensureWikiArticle(db,slug,now);
  const statements=[
    db.prepare(`INSERT INTO hubpedia_wiki_proposals
      (id,article_key,editor_profile_id,base_revision_id,title,summary,body_markdown,edit_reason,source_urls_json,status,requires_manual_approval,created_at,updated_at,risk_level,review_lane,automated_checks)
      VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?)`).bind(id,articleKey,actor.id,baseRevisionKey,title,
        summary,bodyMarkdown,editReason,JSON.stringify(sources),lane==="human"?1:0,now,now,risk,lane,JSON.stringify(checks)),
    db.prepare("INSERT INTO hubpedia_wiki_audit(id,article_key,actor_profile_id,action,target_id,created_at) VALUES(?,?,?,'proposal_submitted',?,?)")
      .bind(crypto.randomUUID(),articleKey,actor.id,id,now),
    ...(sensitive?[db.prepare("UPDATE hubpedia_wiki_articles SET sensitive_category=? WHERE article_key=? AND sensitive_category IS NULL").bind(sensitive,articleKey)]:[]),
    ...(options.extra?options.extra(id,articleKey,now):[])
  ];
  await db.batch(statements);
  if(lane==="instant"){
    const published=await reviewProposal(db,actor,id,true,"Automated low-risk checks passed.");
    return {id,lane:"instant",createdAt:now,...published};
  }
  return {id,status:"pending",lane,risk,createdAt:now};
}

export async function submitWikiProposal(db:D1Database, actor:Profile, input:Record<string,unknown>) {
  const slug=slugOf(String(input.slug ?? ""));
  await assertCanSubmitProposal(db,actor,slug);
  const sources=normalizeSourceUrls(input.sources);
  const title=textOf(input.title,"title",1,160),summary=typeof input.summary==="string"?input.summary.trim().slice(0,600):"",bodyMarkdown=textOf(input.bodyMarkdown,"body",80,80000);
  const editReason=textOf(input.editSummary,"edit summary",3,300),baseRevisionKey=textOf(input.baseRevisionKey,"base revision",1,100);
  return createWikiProposal(db,actor,{slug,title,summary,bodyMarkdown,editReason,baseRevisionKey,sources});
}

export async function listHistory(db:D1Database,slug:string){return (await db.prepare(`SELECT r.id,r.revision_number revisionNumber,r.title,r.edit_reason editSummary,r.created_at createdAt,p.handle authorHandle,
  r.author_kind authorKind,r.contributors_json contributorsJson,r.ai_run_id aiRunId
  FROM hubpedia_wiki_revisions r JOIN hubpedia_wiki_articles a ON a.article_key=r.article_key LEFT JOIN profiles p ON p.id=r.created_by_profile_id
  WHERE a.slug=? AND r.copyright_hidden_at IS NULL ORDER BY r.revision_number DESC LIMIT 100`).bind(slugOf(slug)).all()).results??[];}
export async function listPublicAudit(db:D1Database,slug:string){return (await db.prepare(`SELECT w.action,w.target_id targetId,w.created_at createdAt
  FROM hubpedia_wiki_audit w JOIN hubpedia_wiki_articles a ON a.article_key=w.article_key WHERE a.slug=? AND w.action IN ('article_published','article_protection')
  ORDER BY w.created_at DESC LIMIT 100`).bind(slugOf(slug)).all()).results??[];}
export async function listDiscussion(db:D1Database,slug:string){return (await db.prepare(`SELECT d.id,d.parent_id parentId,d.body,d.created_at createdAt,p.handle authorHandle
  FROM hubpedia_wiki_discussions d JOIN hubpedia_wiki_articles a ON a.article_key=d.article_key JOIN profiles p ON p.id=d.author_profile_id
  WHERE a.slug=? AND d.deleted_at IS NULL AND d.anchor_type IS NULL ORDER BY d.created_at LIMIT 200`).bind(slugOf(slug)).all()).results??[];}
export async function postDiscussion(db:D1Database,actor:Profile,slugValue:string,body:unknown,parentId?:unknown,anchor?:{type:"claim"|"paragraph";id:string}|null){
  const slug=slugOf(slugValue),value=textOf(body,"body",2,5000),id=crypto.randomUUID(),now=new Date().toISOString();
  await assertEditorNotSuspended(db,actor.id,now);
  const recent=await db.prepare("SELECT count(*) count FROM hubpedia_wiki_discussions WHERE author_profile_id=? AND created_at>=?").bind(actor.id,new Date(Date.now()-3600000).toISOString()).first<{count:number}>();
  if((recent?.count??0)>=20)throw new WikiRateLimitError("Too many comments.");
  const articleKey=await ensureWikiArticle(db,slug,now);
  await db.prepare("INSERT INTO hubpedia_wiki_discussions(id,article_key,author_profile_id,parent_id,body,created_at,updated_at,anchor_type,anchor_id) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(id,articleKey,actor.id,typeof parentId==="string"?parentId:null,value,now,now,anchor?.type??null,anchor?.id??null).run(); return {id,createdAt:now};
}
export async function reportDiscussion(db:D1Database,actor:Profile,discussionId:string,reason:unknown){
  const value=textOf(reason,"reason",2,500),id=crypto.randomUUID(),now=new Date().toISOString();
  await db.prepare(`INSERT INTO hubpedia_wiki_discussion_reports(id,discussion_id,reporter_profile_id,reason,created_at)
    VALUES(?,?,?,?,?) ON CONFLICT(discussion_id,reporter_profile_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at`).bind(id,discussionId,actor.id,value,now).run();
  return {reported:true};
}
export async function moderateDiscussion(db:D1Database,actor:Profile,discussionId:string,hide:boolean){
  const now=new Date().toISOString(),status=hide?"hidden":"visible";
  const target=await db.prepare("SELECT article_key articleKey FROM hubpedia_wiki_discussions WHERE id=?").bind(discussionId).first<{articleKey:string}>();
  await db.batch([
    db.prepare("UPDATE hubpedia_wiki_discussions SET deleted_at=?,updated_at=? WHERE id=?").bind(hide?now:null,now,discussionId),
    db.prepare("UPDATE hubpedia_wiki_discussion_reports SET status='resolved' WHERE discussion_id=?").bind(discussionId),
    db.prepare("INSERT INTO hubpedia_wiki_audit(id,article_key,actor_profile_id,action,target_id,created_at) VALUES(?,?,?,'discussion_moderated',?,?)").bind(crypto.randomUUID(),target?.articleKey??null,actor.id,discussionId,now)
  ]);
  return {status};
}
export async function setWatch(db:D1Database,actor:Profile,slugValue:string,watching:boolean){
  const slug=slugOf(slugValue);
  if(watching){const key=await ensureWikiArticle(db,slug);await db.prepare("INSERT OR IGNORE INTO hubpedia_wiki_watches(article_key,profile_id,created_at) VALUES(?,?,?)").bind(key,actor.id,new Date().toISOString()).run();}
  else await db.prepare("DELETE FROM hubpedia_wiki_watches WHERE profile_id=? AND article_key IN (SELECT article_key FROM hubpedia_wiki_articles WHERE slug=?)").bind(actor.id,slug).run();
  return {slug,watching};
}
export async function getWatch(db:D1Database,actor:Profile,slug:string){return Boolean(await db.prepare("SELECT 1 found FROM hubpedia_wiki_watches w JOIN hubpedia_wiki_articles a ON a.article_key=w.article_key WHERE a.slug=? AND w.profile_id=? LIMIT 1").bind(slugOf(slug),actor.id).first());}
export async function listWatches(db:D1Database,actor:Profile){return (await db.prepare("SELECT a.slug slug,w.created_at createdAt FROM hubpedia_wiki_watches w JOIN hubpedia_wiki_articles a ON a.article_key=w.article_key WHERE w.profile_id=? ORDER BY w.created_at DESC LIMIT 200").bind(actor.id).all()).results??[];}

export async function recordArticleView(db:D1Database,slugValue:string){
  const slug=slugOf(slugValue),date=new Date().toISOString().slice(0,10);
  await db.prepare(`INSERT INTO hubpedia_wiki_article_views(article_slug,view_date,view_count) VALUES(?,?,1)
    ON CONFLICT(article_slug,view_date) DO UPDATE SET view_count=view_count+1`).bind(slug,date).run();
  return {recorded:true};
}

export async function upsertWikiAlias(db:D1Database,slugValue:string,aliasValue:unknown,readingValue:unknown,typeValue:unknown){
  const slug=slugOf(slugValue),alias=textOf(aliasValue,"alias",1,160),reading=typeof readingValue==="string"?readingValue.normalize("NFKC").trim().slice(0,160):null;
  const type=typeValue==="redirect"?"redirect":typeValue==="reading"?"reading":"alias";
  await db.prepare(`INSERT INTO hubpedia_wiki_aliases(alias,article_slug,alias_type,locale,reading,created_at) VALUES(?,?,?,'ja',?,?)
    ON CONFLICT(alias) DO UPDATE SET article_slug=excluded.article_slug,alias_type=excluded.alias_type,reading=excluded.reading`).bind(alias,slug,type,reading,new Date().toISOString()).run();
  return {alias,slug,type};
}

export async function setWikiRedirect(db:D1Database,fromValue:string,toValue:string|null){
  const from=slugOf(fromValue),to=toValue?slugOf(toValue):null,now=new Date().toISOString();
  if(to===from)throw new WikiInputError("An article cannot redirect to itself.");
  const key=await ensureWikiArticle(db,from,now);
  await db.prepare("UPDATE hubpedia_wiki_articles SET page_kind=?,redirect_to_slug=?,updated_at=? WHERE article_key=?").bind(to?"redirect":"article",to,now,key).run();
  return {from,to};
}

export async function listPending(db:D1Database){return (await db.prepare(`SELECT q.id,a.slug slug,q.base_revision_id baseRevisionKey,q.title,q.summary,q.body_markdown bodyMarkdown,q.edit_reason editSummary,q.source_urls_json sources,q.created_at createdAt,q.risk_level riskLevel,q.review_lane reviewLane,q.automated_checks automatedChecks,q.ai_review_status aiReviewStatus,q.ai_review_result aiReviewResult,q.conflict_status conflictStatus,p.handle submitterHandle
  FROM hubpedia_wiki_proposals q JOIN hubpedia_wiki_articles a ON a.article_key=q.article_key JOIN profiles p ON p.id=q.editor_profile_id WHERE q.status='pending' ORDER BY q.created_at LIMIT 100`).all()).results??[];}

type ProposalRow={id:string;article_key:string;article_slug:string;editor_profile_id:string;base_revision_id:string|null;title:string;summary:string;body_markdown:string;edit_reason:string;source_urls_json:string};

/** Authorship of the revision currently published for a slug (the text a new edit builds on). */
async function currentAuthorship(db:D1Database,slug:string){
  const wiki=await db.prepare(`SELECT r.author_kind kind,r.contributors_json contributors,r.ai_run_id aiRunId FROM hubpedia_wiki_articles a JOIN hubpedia_wiki_revisions r ON r.id=a.published_revision_id
    WHERE a.slug=? ORDER BY ${KIND_PRIORITY.replace("source_kind","a.source_kind")} LIMIT 1`).bind(slug).first<{kind:AuthorKind;contributors:string;aiRunId:string|null}>();
  if(wiki)return wiki;
  const stored=await db.prepare(`SELECT r.author_kind kind,r.contributors_json contributors,r.ai_run_id aiRunId FROM encyclopedia_articles a
    JOIN encyclopedia_article_revisions r ON r.id=a.current_revision_id WHERE a.slug=? AND a.status='published' LIMIT 1`).bind(slug).first<{kind:AuthorKind;contributors:string;aiRunId:string|null}>();
  return stored??{kind:"human" as AuthorKind,contributors:"[]",aiRunId:null};
}

export async function reviewProposal(db:D1Database,actor:Profile|null,id:string,approve:boolean,note:unknown){
  const q=await db.prepare(`SELECT q.id,q.article_key,a.slug article_slug,q.editor_profile_id,q.base_revision_id,q.title,q.summary,q.body_markdown,q.edit_reason,q.source_urls_json
    FROM hubpedia_wiki_proposals q JOIN hubpedia_wiki_articles a ON a.article_key=q.article_key WHERE q.id=? AND q.status='pending'`).bind(id).first<ProposalRow>();
  if(!q)throw new WikiConflictError("Proposal is no longer pending."); const now=new Date().toISOString(),slug=q.article_slug;
  if(!approve){
    await db.batch([
      db.prepare("UPDATE hubpedia_wiki_proposals SET status='rejected',reviewer_profile_id=?,review_note=?,reviewed_at=?,updated_at=? WHERE id=? AND status='pending'").bind(actor?.id??null,String(note??"").slice(0,1000),now,now,id),
      db.prepare(`INSERT INTO hubpedia_wiki_editor_trust(profile_id,rejected_edits,updated_at) VALUES(?,1,?)
        ON CONFLICT(profile_id) DO UPDATE SET rejected_edits=rejected_edits+1,updated_at=excluded.updated_at`).bind(q.editor_profile_id,now),
      db.prepare("INSERT INTO hubpedia_wiki_audit(id,article_key,actor_profile_id,action,target_id,created_at,detail) VALUES(?,?,?,'proposal_rejected',?,?,?)").bind(crypto.randomUUID(),q.article_key,actor?.id??null,id,now,String(note??"").slice(0,300)||null)
    ]);
    await notify(db,q.editor_profile_id,actor?.id??null,`「${q.title}」の編集提案は今回は採用されませんでした。`,id,now);
    return {status:"rejected"};
  }
  if(actor===null){
    // The automated lane never publishes medical, legal or financial text (design section 10).
    const sensitive=await getSensitiveCategory(db,slug,`${q.title}\n${q.summary}\n${q.body_markdown}`);
    if(sensitive)throw new WikiConflictError(`Human review is required for ${sensitive} entries.`);
  }
  const currentKey=await getWikiRevisionKey(db,slug);
  if(currentKey!==q.base_revision_id){
    await db.prepare("UPDATE hubpedia_wiki_proposals SET conflict_status='stale' WHERE id=? AND status='pending'").bind(id).run();
    await notify(db,q.editor_profile_id,actor?.id??null,`「${q.title}」は他の編集が先に公開されたため、最新版との調整が必要です。`,id,now);
    throw new WikiConflictError("The article changed after this proposal was submitted.");
  }
  const latest=await db.prepare("SELECT COALESCE(MAX(revision_number),0) n FROM hubpedia_wiki_revisions WHERE article_key=?").bind(q.article_key).first<{n:number}>(),number=(latest?.n??0)+1,rid=crypto.randomUUID();
  // A human edit on human text is 'human'; a human edit on AI (or hybrid) text is 'hybrid' and keeps
  // the AI run. Reviewing (even by the automated lane) does not make the reviewer an author.
  const base=await currentAuthorship(db,slug);
  const authorKind:AuthorKind=base.kind==="human"?"human":"hybrid";
  const contributors=boundedContributors(parseContributors(base.contributors),[q.editor_profile_id]);
  let effects:Awaited<ReturnType<typeof prepareClaimEffects>>;
  try{effects=await prepareClaimEffects(db,id,now);}catch(error){if(error instanceof ClaimConflict)throw new WikiConflictError(error.message);throw error;}
  await db.batch([
    db.prepare(`INSERT INTO hubpedia_wiki_revisions(id,article_key,revision_number,proposal_id,title,summary,body_markdown,edit_reason,source_urls_json,created_by_profile_id,created_at,author_kind,contributors_json,ai_run_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rid,q.article_key,number,id,q.title,q.summary,q.body_markdown,q.edit_reason,q.source_urls_json,q.editor_profile_id,now,authorKind,JSON.stringify(contributors),authorKind==="hybrid"?base.aiRunId:null),
    db.prepare("UPDATE hubpedia_wiki_articles SET published_revision_id=?,updated_at=? WHERE article_key=?").bind(rid,now,q.article_key),
    db.prepare("UPDATE hubpedia_wiki_proposals SET status='approved',reviewer_profile_id=?,review_note=?,reviewed_at=?,published_revision_id=?,updated_at=? WHERE id=? AND status='pending'").bind(actor?.id??null,String(note??"").slice(0,1000),now,rid,now,id),
    db.prepare(`INSERT INTO hubpedia_wiki_editor_trust(profile_id,approved_edits,level,updated_at) VALUES(?,1,'newcomer',?)
      ON CONFLICT(profile_id) DO UPDATE SET approved_edits=approved_edits+1,level=CASE WHEN approved_edits+1>=20 THEN 'trusted' WHEN approved_edits+1>=5 THEN 'established' ELSE level END,updated_at=excluded.updated_at`).bind(q.editor_profile_id,now),
    db.prepare("INSERT INTO hubpedia_wiki_audit(id,article_key,actor_profile_id,action,target_id,created_at) VALUES(?,?,?,'article_published',?,?)").bind(crypto.randomUUID(),q.article_key,actor?.id??null,rid,now),
    ...(effects?.statements??[])
  ]);
  if(effects)await effects.after();
  await notify(db,q.editor_profile_id,actor?.id??null,`「${q.title}」の編集が公開されました。`,slug,now);
  const watchers=await db.prepare("SELECT profile_id profileId FROM hubpedia_wiki_watches WHERE article_key=? AND profile_id<>?").bind(q.article_key,q.editor_profile_id).all<{profileId:string}>();
  for(const watcher of watchers.results??[])await notify(db,watcher.profileId,actor?.id??null,`ウォッチ中の「${q.title}」が更新されました。`,slug,now);
  await persistExplanationBlocks(db,slug,`wiki:${number}`,q.body_markdown,now);
  return {status:"approved",revisionId:rid,revisionNumber:number};
}

export async function withdrawProposal(db:D1Database,actor:Profile,id:string){
  const now=new Date().toISOString();
  // The 0073 status CHECK has no 'withdrawn' value: a withdrawn proposal is a
  // closed ('rejected') one with withdrawn_at set, and it earns no trust penalty.
  const result=await db.prepare("UPDATE hubpedia_wiki_proposals SET status='rejected',withdrawn_at=?,reviewed_at=?,review_note='withdrawn by author',updated_at=? WHERE id=? AND editor_profile_id=? AND status='pending'").bind(now,now,now,id,actor.id).run();
  if(!result.meta.changes)throw new WikiConflictError("Proposal is no longer withdrawable.");
  return {status:"withdrawn"};
}

export async function protectWikiArticle(db:D1Database,actor:Profile,slugValue:string,until:string|null,reason:string){
  const slug=slugOf(slugValue),now=new Date().toISOString(),key=await ensureWikiArticle(db,slug,now);
  await db.batch([
    db.prepare("UPDATE hubpedia_wiki_articles SET protected_until=?,protection_reason=?,updated_at=? WHERE article_key=?").bind(until,reason.slice(0,300)||null,now,key),
    db.prepare("INSERT INTO hubpedia_wiki_audit(id,article_key,actor_profile_id,action,target_id,created_at,detail) VALUES(?,?,?,'article_protection',?,?,?)").bind(crypto.randomUUID(),key,actor.id,until??"unprotected",now,reason.slice(0,300)||null)
  ]);
  return {slug,protectedUntil:until};
}

export async function restoreRevision(db:D1Database,actor:Profile,slugValue:string,id:string,reason?:string){
  const slug=slugOf(slugValue);
  const source=await db.prepare(`SELECT r.* FROM hubpedia_wiki_revisions r JOIN hubpedia_wiki_articles a ON a.article_key=r.article_key WHERE r.id=? AND a.slug=?`).bind(id,slug).first<Record<string,string|number|null>>();
  if(!source)throw new WikiInputError("Revision not found.");
  const articleKey=String(source.article_key);
  const latest=await db.prepare("SELECT COALESCE(MAX(revision_number),0) n FROM hubpedia_wiki_revisions WHERE article_key=?").bind(articleKey).first<{n:number}>();
  const now=new Date().toISOString(),number=(latest?.n??0)+1,rid=crypto.randomUUID();
  // A restore re-publishes the original text: it keeps the source's author_kind
  // and AI run, and the restoring user is added as a contributor.
  const kind=(source.author_kind as AuthorKind|null)??"human",contributors=boundedContributors(parseContributors(source.contributors_json),[actor.id]);
  // Re-publishing AI-only text under a human's name would bypass the mandatory human review.
  if(kind==="ai"){
    const sensitive=await getSensitiveCategory(db,slug,`${source.title}\n${source.summary}\n${source.body_markdown}`);
    if(sensitive)throw new WikiPermissionError(`An AI-only revision of a ${sensitive} entry cannot be restored without human review.`);
  }
  const editReason=reason?`Revision ${source.revision_number} restored: ${reason.slice(0,200)}`:`Revision ${source.revision_number} restored`;
  await db.batch([
    db.prepare(`INSERT INTO hubpedia_wiki_revisions(id,article_key,revision_number,restored_from_revision_id,title,summary,body_markdown,edit_reason,source_urls_json,created_by_profile_id,created_at,author_kind,contributors_json,ai_run_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(rid,articleKey,number,id,source.title,source.summary,source.body_markdown,editReason,source.source_urls_json,actor.id,now,kind,JSON.stringify(contributors),source.ai_run_id??null),
    db.prepare("UPDATE hubpedia_wiki_articles SET published_revision_id=?,updated_at=? WHERE article_key=?").bind(rid,now,articleKey),
    db.prepare("INSERT INTO hubpedia_wiki_audit(id,article_key,actor_profile_id,action,target_id,created_at) VALUES(?,?,?,'revision_restored',?,?)").bind(crypto.randomUUID(),articleKey,actor.id,rid,now)
  ]);
  return {revisionId:rid,revisionNumber:number};
}
