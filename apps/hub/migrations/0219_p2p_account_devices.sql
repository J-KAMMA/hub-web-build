-- Temporary, Hub-local presence and encrypted connection invitations only.
CREATE TABLE IF NOT EXISTS p2p_devices (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 40),
  public_key TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS p2p_devices_profile_seen ON p2p_devices(profile_id,last_seen_at);
CREATE TABLE IF NOT EXISTS p2p_device_invitations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_device TEXT NOT NULL REFERENCES p2p_devices(id) ON DELETE CASCADE,
  to_device TEXT NOT NULL REFERENCES p2p_devices(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 40 AND 1024),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined')),
  expires_at INTEGER NOT NULL,
  CHECK(from_device <> to_device)
);
CREATE INDEX IF NOT EXISTS p2p_invitations_recipient ON p2p_device_invitations(to_device,state,expires_at);
