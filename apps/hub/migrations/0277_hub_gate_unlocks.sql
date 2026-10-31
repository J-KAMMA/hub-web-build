-- 入手した作品 (2026-10-26). A private, viewer-only list of gated works the viewer has opened.
-- Hub gates are live token-balance checks, so nothing else records an open.
--
-- Written only when the full server-side gate check grants a viewer who is neither the gate owner
-- nor the author. Read, deleted and exported only by the viewer's own profile. There is no creator,
-- admin, count or aggregate path: the creator must never learn who satisfied a gate or how many did.
-- No wallet address, balance, gate id or chain data is stored. The list is a convenience, never an
-- authorization: opening an entry runs the normal gate check again.
CREATE TABLE IF NOT EXISTS hub_gate_unlocks (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'article', 'video', 'thread')),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
  first_opened_at TEXT NOT NULL,
  last_opened_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_gate_unlocks_recent
  ON hub_gate_unlocks(profile_id, last_opened_at DESC, target_type, target_id);
