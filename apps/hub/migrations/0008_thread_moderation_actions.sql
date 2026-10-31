PRAGMA foreign_keys = ON;

-- Keep author deletion distinct from an operator moderation decision.
ALTER TABLE thread_posts ADD COLUMN moderated_at TEXT;
ALTER TABLE thread_posts ADD COLUMN moderation_reason TEXT;

-- Solved-thread state is stored with the thread and cleared if the selected
-- answer is later removed or hidden.
ALTER TABLE threads ADD COLUMN best_answer_post_id TEXT REFERENCES thread_posts(id) ON DELETE SET NULL;
ALTER TABLE threads ADD COLUMN solved_at TEXT;
