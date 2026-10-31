PRAGMA foreign_keys = ON;
ALTER TABLE social_posts ADD COLUMN moderated_at TEXT;
ALTER TABLE social_posts ADD COLUMN moderation_reason TEXT;
CREATE TABLE IF NOT EXISTS profile_moderation_status (profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('active','suspended')),reason TEXT NOT NULL DEFAULT '' CHECK(length(reason)<=1000),suspended_at TEXT,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS moderation_appeals (id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,message TEXT NOT NULL CHECK(length(message) BETWEEN 20 AND 2000),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','rejected')),resolution_note TEXT NOT NULL DEFAULT '' CHECK(length(resolution_note)<=1000),created_at TEXT NOT NULL,resolved_at TEXT);
CREATE INDEX IF NOT EXISTS idx_moderation_appeals_queue ON moderation_appeals(status,created_at DESC);
CREATE TRIGGER IF NOT EXISTS social_report_rate_limit BEFORE INSERT ON social_post_reports WHEN (SELECT COUNT(*) FROM social_post_reports WHERE reporter_profile_id=NEW.reporter_profile_id AND created_at>=datetime('now','-1 hour'))>=10 BEGIN SELECT RAISE(ABORT,'report_rate_limit'); END;
CREATE TRIGGER IF NOT EXISTS profile_report_rate_limit BEFORE INSERT ON profile_reports WHEN (SELECT COUNT(*) FROM profile_reports WHERE reporter_profile_id=NEW.reporter_profile_id AND created_at>=datetime('now','-1 hour'))>=10 BEGIN SELECT RAISE(ABORT,'report_rate_limit'); END;
CREATE TRIGGER IF NOT EXISTS thread_report_rate_limit BEFORE INSERT ON thread_post_reports WHEN (SELECT COUNT(*) FROM thread_post_reports WHERE reporter_profile_id=NEW.reporter_profile_id AND created_at>=datetime('now','-1 hour'))>=10 BEGIN SELECT RAISE(ABORT,'report_rate_limit'); END;
