-- Hubpedia hybrid, phase 1: Hub items as claim evidence.
--
-- encyclopedia_claim_evidence is keyed by an external source chunk
-- (chunk_id -> encyclopedia_source_chunks -> snapshots -> sources). A Hub item
-- is not an external source and must not be forced through that chain: the
-- 0116 publication guard counts rows in encyclopedia_claim_evidence as
-- source-backed support, and a post or thread must never satisfy it by
-- accident. Hub items therefore get their own table, beside it.

CREATE TABLE IF NOT EXISTS hubpedia_hub_item_evidence (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES encyclopedia_claims(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'post','thread','thread_post','channel_message',
    'research_version','article','video','music_work'
  )),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  stance TEXT NOT NULL DEFAULT 'supports' CHECK (stance IN ('supports','refutes','context')),
  -- SHA-256 (hex) of the canonical content at capture time. A later mismatch
  -- means the item was edited, so the claim must be checked again.
  snapshot_sha256 TEXT NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
  captured_at TEXT NOT NULL,
  -- The only text of the item that Hubpedia keeps. Never the full body.
  quote TEXT NOT NULL CHECK (length(quote) BETWEEN 1 AND 200),
  -- active: usable. stale: the item was edited and awaits re-checking.
  -- withdrawn: deleted, made private, moderated or opted out.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','withdrawn')),
  withdrawn_reason TEXT CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 1 AND 100),
  withdrawn_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (claim_id, kind, item_id),
  CHECK (
    (status = 'active' AND withdrawn_reason IS NULL AND withdrawn_at IS NULL)
    OR (status <> 'active' AND withdrawn_reason IS NOT NULL AND withdrawn_at IS NOT NULL)
  )
);

-- Backlinks: which encyclopedia entries cite this item.
CREATE INDEX IF NOT EXISTS idx_hubpedia_hub_item_evidence_item
  ON hubpedia_hub_item_evidence(kind, item_id, status);
CREATE INDEX IF NOT EXISTS idx_hubpedia_hub_item_evidence_claim
  ON hubpedia_hub_item_evidence(claim_id, status);

-- Profile-level opt-out: "do not use my public posts as encyclopedia material".
-- A row means opted out. No row means allowed (the default).
CREATE TABLE IF NOT EXISTS hubpedia_material_profile_optouts (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

-- Item-level opt-out. profile_id is the author who asked, kept so the choice
-- can be audited and cannot be set on someone else's item.
CREATE TABLE IF NOT EXISTS hubpedia_material_item_optouts (
  kind TEXT NOT NULL CHECK (kind IN (
    'post','thread','thread_post','channel_message',
    'research_version','article','video','music_work'
  )),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, item_id)
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_material_item_optouts_profile
  ON hubpedia_material_item_optouts(profile_id);

-- Persisted keyset cursor for the scheduled revalidation pass. Empty string
-- means "start from the beginning".
CREATE TABLE IF NOT EXISTS hubpedia_hub_evidence_cursor (
  name TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
