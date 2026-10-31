import type { D1Database } from "@cloudflare/workers-types";
import { parseExplanationBlocks,renderExplanationBlocks,type ExplanationBlock } from "@/lib/encyclopedia/explanation-engine";
async function digest(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
const urlsIn=(value:string)=>[...new Set([...value.matchAll(/https?:\/\/[^\s)\]]+/gu)].map(match=>match[0]))].slice(0,20);

export async function persistExplanationBlocks(db:D1Database,slug:string,revisionKey:string,markdown:string,verifiedAt:string|null=null){
 const blocks=parseExplanationBlocks(markdown),now=new Date().toISOString();
 const statements=[db.prepare("DELETE FROM hubpedia_explanation_blocks WHERE article_slug=? AND revision_key=?").bind(slug,revisionKey)];
 for(const block of blocks)statements.push(db.prepare(`INSERT INTO hubpedia_explanation_blocks
  (id,article_slug,revision_key,block_key,block_role,heading,body_markdown,subject_concept,source_urls,position,last_verified_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),slug,revisionKey,block.key,block.role,block.heading,block.bodyMarkdown,block.heading,JSON.stringify(urlsIn(block.bodyMarkdown)),block.position,verifiedAt,now,now));
 statements.push(db.prepare("DELETE FROM hubpedia_explanation_variants WHERE article_slug=? AND revision_key=?").bind(slug,revisionKey));await db.batch(statements);return blocks;
}

async function loadBlocks(db:D1Database,slug:string,revisionKey:string){const rows=await db.prepare(`SELECT block_key key,block_role role,heading,body_markdown bodyMarkdown,position FROM hubpedia_explanation_blocks
 WHERE article_slug=? AND revision_key=? ORDER BY position`).bind(slug,revisionKey).all<ExplanationBlock>();return rows.results??[];}

export async function getExplanationVariant(db:D1Database,input:{slug:string;revisionKey:string;locale:string;title:string;summary:string|null;bodyMarkdown:string}){
 const sourceHash=await digest(input.bodyMarkdown),cached=await db.prepare(`SELECT title,summary,body_markdown bodyMarkdown,generation_method generationMethod FROM hubpedia_explanation_variants
  WHERE article_slug=? AND revision_key=? AND locale=? AND audience='standard' AND source_hash=? AND status='ready' ORDER BY updated_at DESC LIMIT 1`).bind(input.slug,input.revisionKey,input.locale,sourceHash).first<{title:string;summary:string|null;bodyMarkdown:string;generationMethod:string}>();
 if(cached)return {...cached,cached:true};
 let blocks=await loadBlocks(db,input.slug,input.revisionKey);if(!blocks.length)blocks=await persistExplanationBlocks(db,input.slug,input.revisionKey,input.bodyMarkdown);
 const bodyMarkdown=renderExplanationBlocks(blocks),now=new Date().toISOString();
 await db.prepare(`INSERT INTO hubpedia_explanation_variants(id,article_slug,revision_key,locale,audience,title,summary,body_markdown,source_hash,generation_method,status,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,'ready',?,?) ON CONFLICT(article_slug,revision_key,locale,audience,source_hash) DO UPDATE SET updated_at=excluded.updated_at`).bind(crypto.randomUUID(),input.slug,input.revisionKey,input.locale,"standard",input.title,input.summary,bodyMarkdown,sourceHash,"deterministic-block-render",now,now).run();
 return {title:input.title,summary:input.summary,bodyMarkdown,generationMethod:"deterministic-block-render",cached:false};
}

export async function replaceExplanationBlock(db:D1Database,input:{slug:string;revisionKey:string;blockKey:string;bodyMarkdown:string}){
 const value=input.bodyMarkdown.normalize("NFC").trim();if(value.length<20||value.length>30000)throw new Error("Explanation block has an invalid length.");
 const existing=await loadBlocks(db,input.slug,input.revisionKey),changedIndex=existing.findIndex((block)=>block.key===input.blockKey);
 const now=new Date().toISOString(),result=await db.prepare(`UPDATE hubpedia_explanation_blocks SET body_markdown=?,source_urls=?,last_verified_at=NULL,updated_at=?
  WHERE article_slug=? AND revision_key=? AND block_key=?`).bind(value,JSON.stringify(urlsIn(value)),now,input.slug,input.revisionKey,input.blockKey).run();
 if(!result.meta.changes)throw new Error("Explanation block not found.");await db.prepare("DELETE FROM hubpedia_explanation_variants WHERE article_slug=? AND revision_key=?").bind(input.slug,input.revisionKey).run();
 const affectedBlocks=changedIndex<0?[input.blockKey]:existing.slice(Math.max(0,changedIndex-1),changedIndex+2).map((block)=>block.key);
 return {updated:true,affectedBlocks,requiresArticleReaudit:true};
}

export async function listExplanationBlocks(db:D1Database,slug:string,revisionKey:string){return (await db.prepare(`SELECT id,block_key blockKey,block_role role,heading,body_markdown bodyMarkdown,subject_concept subjectConcept,source_urls sourceUrls,position,last_verified_at lastVerifiedAt
 FROM hubpedia_explanation_blocks WHERE article_slug=? AND revision_key=? ORDER BY position`).bind(slug,revisionKey).all()).results??[];}

export async function linkExplanationClaim(db:D1Database,input:{slug:string;revisionKey:string;blockKey:string;claimId:string;relation:string}){
 const relation=["supports","qualifies","contradicts","depends_on"].includes(input.relation)?input.relation:"supports";
 const block=await db.prepare("SELECT id FROM hubpedia_explanation_blocks WHERE article_slug=? AND revision_key=? AND block_key=?").bind(input.slug,input.revisionKey,input.blockKey).first<{id:string}>();if(!block)throw new Error("Explanation block not found.");
 await db.prepare(`INSERT INTO hubpedia_explanation_block_claims(block_id,claim_id,relation) VALUES(?,?,?)
  ON CONFLICT(block_id,claim_id) DO UPDATE SET relation=excluded.relation`).bind(block.id,input.claimId,relation).run();return {linked:true};
}
