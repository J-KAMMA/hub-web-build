-- Hubpedia hybrid, phase 2: topic candidates found in public Hub activity
-- (docs/hubpedia-hybrid/DESIGN.md sections 2, 7 and 9).
--
-- hubpedia_article_candidates (0120) stays the review queue. These tables sit
-- beside it: a signal index that makes the scan incremental, a keyset cursor
-- per item kind, and the cluster that justified each machine-found candidate.
-- Nothing here stores post text; only ids, signal keys and counts.

-- One row per (signal, public item). Rebuilt for an item every time the scan
-- sees it, and deleted as soon as the item stops being usable material.
CREATE TABLE IF NOT EXISTS hubpedia_hub_topic_signals (
  signal_key TEXT NOT NULL CHECK (length(signal_key) BETWEEN 3 AND 200),
  kind TEXT NOT NULL CHECK (kind IN (
    'post','thread','thread_post','channel_message',
    'research_version','article','video','music_work'
  )),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (signal_key, kind, item_id)
);
-- Find and clear every signal of one item.
CREATE INDEX IF NOT EXISTS idx_hubpedia_hub_topic_signals_item
  ON hubpedia_hub_topic_signals(kind, item_id);
CREATE INDEX IF NOT EXISTS idx_hubpedia_hub_topic_signals_author
  ON hubpedia_hub_topic_signals(author_profile_id);

-- Keyset cursor per item kind. Empty string means "start from the beginning".
CREATE TABLE IF NOT EXISTS hubpedia_hub_topic_scan_cursor (
  kind TEXT PRIMARY KEY CHECK (kind IN (
    'post','thread','thread_post','channel_message',
    'research_version','article','video','music_work'
  )),
  cursor TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- The cluster behind a machine-found hubpedia_article_candidates row.
-- The thresholds are enforced here as well as in code: a candidate that rests
-- on fewer than three authors or a single kind of item cannot be recorded.
CREATE TABLE IF NOT EXISTS hubpedia_hub_topic_candidates (
  candidate_id TEXT PRIMARY KEY REFERENCES hubpedia_article_candidates(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL UNIQUE,
  topic_label TEXT NOT NULL CHECK (length(topic_label) BETWEEN 2 AND 160),
  author_count INTEGER NOT NULL CHECK (author_count >= 3),
  kind_count INTEGER NOT NULL CHECK (kind_count >= 2),
  item_count INTEGER NOT NULL CHECK (item_count >= 3),
  detected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Filled when the factory has produced a draft from this candidate.
  draft_article_slug TEXT,
  draft_ai_run_id TEXT,
  drafted_at TEXT
);

CREATE TABLE IF NOT EXISTS hubpedia_hub_topic_candidate_items (
  candidate_id TEXT NOT NULL REFERENCES hubpedia_hub_topic_candidates(candidate_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'post','thread','thread_post','channel_message',
    'research_version','article','video','music_work'
  )),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  PRIMARY KEY (candidate_id, kind, item_id)
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_hub_topic_candidate_items_item
  ON hubpedia_hub_topic_candidate_items(kind, item_id);
