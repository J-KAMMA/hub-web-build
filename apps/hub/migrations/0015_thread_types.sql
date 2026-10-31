PRAGMA foreign_keys = ON;

ALTER TABLE threads ADD COLUMN thread_type TEXT NOT NULL DEFAULT 'chat'
  CHECK (thread_type IN ('question','information','recruitment','chat'));

-- Threads that already have a selected answer are unambiguously questions.
UPDATE threads SET thread_type = 'question' WHERE best_answer_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_threads_type_updated ON threads(thread_type, updated_at DESC);
