import type {D1Database} from "@cloudflare/workers-types";
import {notGatedSql} from "@/lib/server/gated-exits";

/** Hub-local public general articles only; no Vault identifiers or bodies. */
export async function saveUserArticle(db:D1Database,profileId:string,articleId:string):Promise<boolean>{
 const result=await db.prepare(`INSERT INTO hub_user_article_saves(profile_id,article_id,created_at)
 SELECT ?, a.id, ? FROM hub_user_articles a
 WHERE a.id=? AND a.status='published' AND a.audience='general' AND a.moderated_at IS NULL
 ON CONFLICT(profile_id,article_id) DO UPDATE SET created_at=hub_user_article_saves.created_at`)
 .bind(profileId,new Date().toISOString(),articleId).run();
 return Number(result.meta.changes??0)>0;
}
export async function unsaveUserArticle(db:D1Database,profileId:string,articleId:string):Promise<void>{
 await db.prepare('DELETE FROM hub_user_article_saves WHERE profile_id=? AND article_id=?').bind(profileId,articleId).run();
}
export async function isUserArticleSaved(db:D1Database,profileId:string,articleId:string):Promise<boolean>{
 return Boolean(await db.prepare('SELECT article_id FROM hub_user_article_saves WHERE profile_id=? AND article_id=?').bind(profileId,articleId).first());
}
export type SavedUserArticle={id:string;title:string;summary:string;createdAt:string};
export async function listSavedUserArticles(db:D1Database,profileId:string,after=""):Promise<{articles:SavedUserArticle[];nextCursor:string|null}>{
 // A gated article is listed by title only, as in every other listing.
 const result=await db.prepare(`SELECT a.id,a.title,CASE WHEN ${notGatedSql("article","a.id")} THEN a.summary ELSE '' END AS summary,s.created_at
 FROM hub_user_article_saves s JOIN hub_user_articles a ON a.id=s.article_id
 WHERE s.profile_id=? AND s.article_id>? AND a.status='published' AND a.audience='general' AND a.moderated_at IS NULL
 ORDER BY s.article_id ASC LIMIT 101`).bind(profileId,after).all<{id:string;title:string;summary:string;created_at:string}>();
 const rows=result.results.slice(0,100);
 return {articles:rows.map(row=>({id:row.id,title:row.title,summary:row.summary,createdAt:row.created_at})),nextCursor:result.results.length>100?rows.at(-1)!.id:null};
}
