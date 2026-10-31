INSERT OR IGNORE INTO boards(id,board_key,title,slug,description,created_at,updated_at)
VALUES ('board-embedded-hubpedia','embedded-hubpedia_article','Hubpedia','embedded-hubpedia_article','Hubpedia記事のトーク',datetime('now'),datetime('now')),
       ('board-embedded-video','embedded-video','動画','embedded-video','動画のトーク',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO threads(id,board_id,created_by_profile_id,title,language,region,thread_type,tags_json,slow_mode_seconds,pinned,created_at,updated_at,status,moderation_status)
SELECT 'hubpedia-talk-'||article_key,'board-embedded-hubpedia',
  (SELECT author_profile_id FROM hubpedia_wiki_discussions x WHERE x.article_key=d.article_key ORDER BY created_at LIMIT 1),
  'Hubpedia記事のトーク','ja','global','chat','[]',0,0,MIN(created_at),MAX(updated_at),'open','active'
FROM hubpedia_wiki_discussions d GROUP BY article_key;
INSERT OR IGNORE INTO hub_thread_targets(thread_id,target_type,target_id,created_at)
SELECT 'hubpedia-talk-'||article_key,'hubpedia_article',article_key,MIN(created_at)
FROM hubpedia_wiki_discussions GROUP BY article_key;
INSERT OR IGNORE INTO thread_posts(id,thread_id,post_no,author_profile_id,display_name,body,reply_to_post_id,created_at,is_anonymous,edited_at,deleted_at,moderated_at,moderation_reason)
SELECT d.id,'hubpedia-talk-'||d.article_key,
  ROW_NUMBER() OVER(PARTITION BY d.article_key ORDER BY d.created_at,d.id),
  d.author_profile_id,p.display_name,d.body,d.parent_id,d.created_at,0,
  CASE WHEN d.updated_at<>d.created_at THEN d.updated_at END,d.deleted_at,d.deleted_at,NULL
FROM hubpedia_wiki_discussions d JOIN profiles p ON p.id=d.author_profile_id;

INSERT OR IGNORE INTO threads(id,board_id,created_by_profile_id,title,language,region,thread_type,tags_json,slow_mode_seconds,pinned,created_at,updated_at,status,moderation_status)
SELECT 'video-talk-'||video_id,'board-embedded-video',
  (SELECT profile_id FROM video_thread_comments x WHERE x.video_id=c.video_id ORDER BY created_at LIMIT 1),
  '動画のトーク','ja','global','chat','[]',0,0,MIN(created_at),MAX(updated_at),'open','active'
FROM video_thread_comments c GROUP BY video_id;
INSERT OR IGNORE INTO hub_thread_targets(thread_id,target_type,target_id,created_at)
SELECT 'video-talk-'||video_id,'video',video_id,MIN(created_at) FROM video_thread_comments GROUP BY video_id;
INSERT OR IGNORE INTO thread_posts(id,thread_id,post_no,author_profile_id,display_name,body,reply_to_post_id,created_at,is_anonymous,edited_at,deleted_at,moderated_at,moderation_reason)
SELECT c.id,'video-talk-'||c.video_id,ROW_NUMBER() OVER(PARTITION BY c.video_id ORDER BY c.created_at,c.id),c.profile_id,p.display_name,c.body,c.parent_comment_id,c.created_at,0,
  CASE WHEN c.updated_at<>c.created_at THEN c.updated_at END,NULL,CASE WHEN c.status<>'published' THEN c.updated_at END,NULL
FROM video_thread_comments c JOIN profiles p ON p.id=c.profile_id;
