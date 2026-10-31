ALTER TABLE threads ADD COLUMN allowed_languages_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE thread_posts ADD COLUMN declared_language TEXT;
ALTER TABLE thread_posts ADD COLUMN declared_region TEXT;

UPDATE threads SET allowed_languages_json = json_array(language) WHERE allowed_languages_json = '[]';
UPDATE thread_posts
SET declared_language = (SELECT language FROM threads WHERE threads.id = thread_posts.thread_id),
    declared_region = (SELECT region FROM threads WHERE threads.id = thread_posts.thread_id)
WHERE declared_language IS NULL OR declared_region IS NULL;

CREATE INDEX IF NOT EXISTS idx_thread_posts_scope
  ON thread_posts(thread_id, declared_language, declared_region, created_at);
