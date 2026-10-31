CREATE INDEX IF NOT EXISTS idx_thread_posts_thread_post_no ON thread_posts(thread_id, post_no);
CREATE INDEX IF NOT EXISTS idx_thread_tracking_thread_followers ON thread_tracking(thread_id, following, notification_mode, profile_id);
