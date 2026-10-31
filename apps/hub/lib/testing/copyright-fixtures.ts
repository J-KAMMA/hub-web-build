import type { DatabaseSync } from "node:sqlite";

/* 著作権の試験の共通の種。本物の migration を流した D1 代用品（sqliteHubD1）に、対象の行を入れる。 */

export const T0 = "2026-10-01T00:00:00.000Z";

export function seedProfiles(sql: DatabaseSync, ids: string[] = ["author", "reporter", "other"]) {
  for (const id of ids) {
    sql.prepare("INSERT INTO profiles(id,handle,display_name,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .run(id, id, `名前-${id}`, T0, T0, T0);
  }
}

export function seedPost(sql: DatabaseSync, id: string, author = "author", body = `zebrafoxtrot 本文 ${id}`) {
  sql.prepare(`INSERT INTO social_posts(id,author_profile_id,display_name,handle,identity_mode,body,created_at)
    VALUES(?,?,?,?, 'account', ?, ?)`).run(id, author, `名前-${author}`, author, body, T0);
}

export function seedImage(sql: DatabaseSync, id: string, postId: string | null, owner = "author") {
  sql.prepare(`INSERT INTO social_post_images(id,owner_profile_id,post_id,object_key,thumbnail_object_key,mime_type,byte_size,width,height,
    alt_text,status,content_hash,created_at,published_at,metadata_stripped_at)
    VALUES(?,?,?,?,?,'image/png',10,10,10,'', 'published', ?, ?, ?, ?)`)
    .run(id, owner, postId, `obj/${id}`, `thumb/${id}`, `hash-${id}`, T0, T0, T0);
}

export function seedArticle(sql: DatabaseSync, id: string, author = "author") {
  sql.prepare(`INSERT INTO hub_user_articles(id,author_profile_id,title,summary,body,tags_json,audience,status,created_at,updated_at)
    VALUES(?,?,?,'要約','zebrafoxtrot 記事の本文 ${id}','[]','general','published',?,?)`).run(id, author, `zebrafoxtrot 題 ${id}`, T0, T0);
}

export function seedVideo(sql: DatabaseSync, id: string, submitter = "author") {
  sql.prepare(`INSERT INTO external_videos(id,provider,external_video_id,source_url,title,channel,category,published_at,
    submitted_by_profile_id,created_at,updated_at) VALUES(?, 'youtube', ?, ?, ?, 'ch', 'cat', ?, ?, ?, ?)`)
    .run(id, `yt-${id}`, `https://www.youtube.com/watch?v=yt-${id}`, `zebrafoxtrot 動画 ${id}`, T0, submitter, T0, T0);
}

/** wiki の記事に revisions 個の版を入れ、最後の版を公開の版にする。版のIDは `${slug}-r${n}`。 */
export function seedWikiArticle(sql: DatabaseSync, slug: string, revisions: number, author = "author") {
  const key = `static:${slug}`;
  sql.prepare("INSERT INTO hubpedia_wiki_articles(article_key,source_kind,source_id,slug,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run(key, "static_seed", slug, slug, T0, T0);
  for (let n = 1; n <= revisions; n += 1) {
    sql.prepare(`INSERT INTO hubpedia_wiki_revisions(id,article_key,revision_number,title,summary,body_markdown,edit_reason,source_urls_json,created_by_profile_id,created_at)
      VALUES(?,?,?,?,?,?,?,'[]',?,?)`).run(`${slug}-r${n}`, key, n, `題 ${slug}`, "", `版${n}の本文`, "編集理由です", author, T0);
  }
  sql.prepare("UPDATE hubpedia_wiki_articles SET published_revision_id=? WHERE article_key=?").run(`${slug}-r${revisions}`, key);
}
