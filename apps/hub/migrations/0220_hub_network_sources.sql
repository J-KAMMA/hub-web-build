-- Only Hub-local profile identifiers and public Hub origins.
CREATE TABLE IF NOT EXISTS hub_network_sources (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK(length(origin) BETWEEN 1 AND 512),
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, origin)
);
