-- Which works already have a vector, and from which model. Without this a
-- rerun re-embeds everything, and embedding is the part that costs money.
CREATE TABLE IF NOT EXISTS music_work_vectors (
  work_id TEXT PRIMARY KEY REFERENCES music_works(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  embedded_at TEXT NOT NULL
);
