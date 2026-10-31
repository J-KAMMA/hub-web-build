-- Content download permission (2026-10-17, owner-approved; docs/hub-downloads/DESIGN.md).
--
-- content_download_settings: the creator's choice per Hub-owned work. No row means 'none'.
-- Files attached to a post or article and the post's images follow that post or article.
-- Music tracks keep their own setting in the Music service.
CREATE TABLE IF NOT EXISTS content_download_settings (
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'article', 'video')),
  target_id TEXT NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN ('none', 'entitled', 'anyone')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id)
);

-- Attachments were published under "readers who pass the gate may download". Keep that promise.
INSERT OR IGNORE INTO content_download_settings (target_type, target_id, policy, updated_at)
SELECT DISTINCT target_type, target_id, 'entitled', '2026-10-17T00:00:00.000Z'
FROM hub_content_files
WHERE target_id IS NOT NULL AND target_type IN ('post', 'article');

-- hub_download_grants: one row per download Hub authorized. `id` is the opaque watermark ID and
-- the ticket's `jti`: a random UUID that never contains a profile, wallet or Account subject.
-- Only this table maps it back to a profile. Purged at purge_after (365 days after issue).
-- For images Hub owns the bytes, so the row itself is the single-use ticket (consumed_at).
CREATE TABLE IF NOT EXISTS hub_download_grants (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('file', 'video', 'music', 'image')),
  object_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'article', 'video', 'music')),
  target_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  purge_after TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hub_download_grants_purge ON hub_download_grants(purge_after);
CREATE INDEX IF NOT EXISTS hub_download_grants_profile ON hub_download_grants(profile_id, issued_at);
