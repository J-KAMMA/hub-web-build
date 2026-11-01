-- Video comments are social_posts rows (0309). The three legacy video_thread_comment tables held mock data
-- only (owner, 2026-11-01: nothing to preserve, no compatibility), so they are dropped without a migration.
-- Their routes, lib, UI and the export/deletion references were removed in the same change.
-- social_post_video_refs stays: video-public-origin and the tag triggers (0286) still read it; nothing writes it.
DROP TABLE IF EXISTS video_thread_comment_reports;
DROP TABLE IF EXISTS video_thread_comment_likes;
DROP TABLE IF EXISTS video_thread_comments;
